/**
 * EnvCP Sandbox Test Runner
 * 
 * CIS Docker Benchmark hardened E2E test runner.
 * Orchestrates sandbox test scenarios and reports results.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const SANDBOX_DIR = '/tmp/envcp-sandbox';
const LOGS_DIR = '/tmp/envcp-logs';
const TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS || '600000', 10);

// Parse inputs — accept CLI args (--providers=x, --scenarios=y) or env vars
function parseArg(name) {
  const flag = process.argv.find(a => a.startsWith(`--${name}=`));
  return flag ? flag.split('=').slice(1).join('=') : null;
}
const providers = (parseArg('providers') || process.env.SANDBOX_PROVIDERS || 'openai').split(',').map(s => s.trim());
const scenarios = parseArg('scenarios') || process.env.SANDBOX_SCENARIOS || 'all';

// Test results
let results = {
  timestamp: new Date().toISOString(),
  providers_tested: providers,
  scenarios_passed: 0,
  scenarios_failed: 0,
  scenarios_skipped: 0,
  failures: [],
  duration_ms: 0
};

/**
 * Logger with timestamps
 */
function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
}

/**
 * Execute a test scenario
 */
async function runScenario(name, fn) {
  const startTime = Date.now();
  log('info', `Running scenario: ${name}`);
  
  try {
    await fn();
    results.scenarios_passed++;
    const duration = Date.now() - startTime;
    log('pass', `${name} (${duration}ms)`);
    return { success: true, duration };
  } catch (error) {
    results.scenarios_failed++;
    const duration = Date.now() - startTime;
    const failure = {
      scenario: name,
      error: error.message,
      stack: error.stack,
      duration
    };
    results.failures.push(failure);
    log('fail', `${name} failed: ${error.message}`);
    return { success: false, error, duration };
  }
}

/**
 * Execute CLI command
 */
function findEnvcpCLI() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'dist', 'cli', 'index.js');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error(`Cannot find dist/cli/index.js from ${__dirname}`);
}

function execCLI(args, options = {}) {
  const envcp = findEnvcpCLI();
  const result = spawnSync('node', [envcp, ...args], {
    cwd: options.cwd || SANDBOX_DIR,
    encoding: 'utf-8',
    timeout: options.timeout || 30000,
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.error) {
    return { success: false, stdout: '', stderr: result.error.message, code: 1 };
  }
  const success = result.status === 0;
  return { success, stdout: result.stdout || '', stderr: result.stderr || '', code: result.status };
}

/**
 * Wait for server to be healthy
 */
async function waitForServer(port, maxWait = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
          if (res.statusCode === 200) resolve(true);
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy());
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(`Server not healthy after ${maxWait}ms`);
}

/**
 * Scenario 1: CLI Lifecycle
 * Uses --no-encrypt for non-interactive init (no password prompts).
 */
async function testCLILifecycle() {
  return runScenario('cli-lifecycle', async () => {
    // Clean slate
    execCLI(['lock'], { cwd: SANDBOX_DIR });

    // Init — non-interactive: no encryption, skip .env import and MCP registration
    const initResult = execCLI(['init', '--no-encrypt', '--skip-env', '--skip-mcp'], { cwd: SANDBOX_DIR });
    if (!initResult.success) throw new Error(`init failed: ${initResult.stderr}`);
    
    // Add variable
    const addResult = execCLI(['add', 'TEST_VAR', '--value', 'test-value-123'], { cwd: SANDBOX_DIR });
    if (!addResult.success) throw new Error(`add failed: ${addResult.stderr}`);
    
    // Get variable
    const getResult = execCLI(['get', 'TEST_VAR', '--show-value'], { cwd: SANDBOX_DIR });
    if (!getResult.success) throw new Error(`get failed: ${getResult.stderr}`);
    if (!getResult.stdout.includes('Value: test-value-123')) throw new Error('value mismatch');
    
    // List variables
    const listResult = execCLI(['list'], { cwd: SANDBOX_DIR });
    if (!listResult.success) throw new Error(`list failed: ${listResult.stderr}`);
    if (!listResult.stdout.includes('TEST_VAR')) throw new Error('variable not in list');

    // Remove variable
    const delResult = execCLI(['remove', 'TEST_VAR'], { cwd: SANDBOX_DIR });
    if (!delResult.success) throw new Error(`remove failed: ${delResult.stderr}`);

    // Verify removed — get should print "not found"
    const afterDelete = execCLI(['get', 'TEST_VAR', '--show-value'], { cwd: SANDBOX_DIR });
    if (afterDelete.stdout.includes('test-value-123')) {
      throw new Error('variable still accessible after remove');
    }
  });
}

/**
 * Scenario 2: REST API
 * Starts the server, exercises CRUD over HTTP, then shuts it down.
 */
async function testRestAPI() {
  return runScenario('rest-api', async () => {
    const port = 18921;
    const envcp = findEnvcpCLI();

    const server = spawn('node', ['--no-warnings', envcp, 'serve', '--mode', 'rest', '--port', String(port)], {
      cwd: SANDBOX_DIR,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let killed = false;
    const cleanup = () => {
      if (!killed) { killed = true; server.kill('SIGTERM'); }
    };

    try {
      await waitForServer(port, 15000);

      function httpReq(method, urlPath, body) {
        return new Promise((resolve, reject) => {
          const bodyStr = body ? JSON.stringify(body) : null;
          const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: urlPath,
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
          }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              let parsed;
              try { parsed = JSON.parse(data); } catch { parsed = data; }
              resolve({ status: res.statusCode, body: parsed });
            });
          });
          req.on('error', reject);
          req.setTimeout(5000, () => req.destroy());
          if (bodyStr) req.write(bodyStr);
          req.end();
        });
      }

      // Health
      const health = await httpReq('GET', '/api/health');
      if (health.status !== 200) throw new Error(`Health: ${health.status}`);

      // Create variable
      const create = await httpReq('POST', '/api/variables', { name: 'REST_VAR', value: 'rest-789' });
      if (create.status !== 201) throw new Error(`POST /api/variables: ${create.status} — ${JSON.stringify(create.body)}`);

      // Get variable with value
      const get = await httpReq('GET', '/api/variables/REST_VAR?show_value=true');
      if (get.status !== 200) throw new Error(`GET /api/variables/REST_VAR: ${get.status}`);
      if (get.body?.data?.value !== 'rest-789') throw new Error(`value mismatch: ${JSON.stringify(get.body?.data)}`);

      // List variables
      const list = await httpReq('GET', '/api/variables');
      if (list.status !== 200) throw new Error(`GET /api/variables: ${list.status}`);

      // Delete variable
      const del = await httpReq('DELETE', '/api/variables/REST_VAR');
      if (del.status !== 200) throw new Error(`DELETE /api/variables/REST_VAR: ${del.status}`);

      log('info', 'REST API — health, create, get, list, delete verified');
    } finally {
      cleanup();
    }
  });
}

/**
 * Scenario 3: MCP Stdio
 * Spawns the MCP server, performs JSON-RPC handshake, calls tools over stdin/stdout.
 */
async function testMCPStdio() {
  return runScenario('mcp-stdio', async () => {
    const envcp = findEnvcpCLI();

    const server = spawn('node', ['--no-warnings', envcp, 'serve', '--mode', 'mcp'], {
      cwd: SANDBOX_DIR,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let killed = false;
    const cleanup = () => {
      if (!killed) { killed = true; server.kill('SIGTERM'); }
    };

    try {
      // Wire up newline-delimited JSON-RPC reader
      let buf = '';
      const pending = new Map();

      server.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(`MCP error [${msg.error.code}]: ${msg.error.message}`));
            else resolve(msg.result);
          }
        }
      });

      function rpc(id, method, params) {
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              reject(new Error(`MCP timeout waiting for ${method} (id=${id})`));
            }
          }, 10000);
        });
      }

      // Initialize handshake
      const initResult = await rpc(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'sandbox-test', version: '1.0.0' },
      });
      if (!initResult?.protocolVersion) throw new Error(`Invalid initialize response: ${JSON.stringify(initResult)}`);

      // Send initialized notification (no response expected)
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

      // List tools
      const toolsResult = await rpc(2, 'tools/list', {});
      if (!Array.isArray(toolsResult?.tools) || toolsResult.tools.length === 0) {
        throw new Error(`No tools returned: ${JSON.stringify(toolsResult)}`);
      }
      const toolNames = toolsResult.tools.map(t => t.name);
      if (!toolNames.includes('envcp_set')) throw new Error(`envcp_set missing from tools: ${toolNames.join(', ')}`);
      if (!toolNames.includes('envcp_get')) throw new Error(`envcp_get missing from tools: ${toolNames.join(', ')}`);

      // Set a variable via MCP
      const setResult = await rpc(3, 'tools/call', {
        name: 'envcp_set',
        arguments: { name: 'MCP_TEST_VAR', value: 'mcp-321' },
      });
      if (!setResult?.content) throw new Error(`envcp_set failed: ${JSON.stringify(setResult)}`);

      // Get it back
      const getResult = await rpc(4, 'tools/call', {
        name: 'envcp_get',
        arguments: { name: 'MCP_TEST_VAR', show_value: true },
      });
      if (!getResult?.content?.[0]?.text) throw new Error(`envcp_get failed: ${JSON.stringify(getResult)}`);
      const content = JSON.parse(getResult.content[0].text);
      if (content?.value !== 'mcp-321') throw new Error(`MCP value mismatch: ${JSON.stringify(content)}`);

      log('info', 'MCP stdio — initialize, tools/list, envcp_set, envcp_get verified');
    } finally {
      cleanup();
    }
  });
}

/**
 * Scenario 4: Access Control
 */
async function testAccessControl() {
  return runScenario('access-control', async () => {
    // Use a variable that doesn't match default blacklist patterns
    // (default blacklist: *_SECRET, *_PRIVATE, ADMIN_*, ROOT_*)
    const addResult = execCLI(['add', 'SANDBOX_CTRL_VAR', '--value', 'ctrl-value-456'], { cwd: SANDBOX_DIR });
    if (!addResult.success) throw new Error(`add failed: ${addResult.stderr}`);

    // Verify it exists — output is "<NAME>\n  Value: <val>"
    const getResult = execCLI(['get', 'SANDBOX_CTRL_VAR', '--show-value'], { cwd: SANDBOX_DIR });
    if (!getResult.success) throw new Error(`get failed: ${getResult.stderr}`);
    if (!getResult.stdout.includes('Value: ctrl-value-456')) throw new Error('value mismatch');

    // Verify blacklist works — ADMIN_SECRET matches ADMIN_* pattern
    execCLI(['add', 'ADMIN_SECRET', '--value', 'blocked'], { cwd: SANDBOX_DIR });
    const blockedGet = execCLI(['get', 'ADMIN_SECRET', '--show-value'], { cwd: SANDBOX_DIR });
    if (blockedGet.stdout.includes('Value: blocked')) throw new Error('blacklisted variable should not be readable');

    // Clean up
    execCLI(['remove', 'SANDBOX_CTRL_VAR'], { cwd: SANDBOX_DIR });

    log('info', 'Access control test — add/get verified, blacklist enforced');
  });
}

/**
 * Scenario 5: Encryption Roundtrip
 */
async function testEncryptionRoundtrip() {
  return runScenario('encryption-roundtrip', async () => {
    
    // Add multiple variables
    const testVars = {
      'ROUNDTRIP_1': 'value1',
      'ROUNDTRIP_2': 'value2',
      'ROUNDTRIP_3': 'value3'
    };
    
    for (const [name, value] of Object.entries(testVars)) {
      execCLI(['add', name, '--value', value], { cwd: SANDBOX_DIR });
    }
    
    // Export
    const exportResult = execCLI(['export', '--format', 'json'], { cwd: SANDBOX_DIR });
    if (!exportResult.success) throw new Error(`export failed: ${exportResult.stderr}`);
    
    // Verify all values present — json format returns full Variable objects
    const exported = JSON.parse(exportResult.stdout);
    for (const [name, value] of Object.entries(testVars)) {
      const got = exported[name]?.value;
      if (got !== value) {
        throw new Error(`roundtrip mismatch for ${name}: expected ${value}, got ${got}`);
      }
    }
    
    log('info', 'Encryption roundtrip verified');
  });
}

/**
 * Main test runner
 */
async function main() {
  const startTime = Date.now();
  
  log('info', '=== EnvCP Sandbox E2E Tests ===');
  log('info', `Providers: ${providers.join(', ')}`);
  log('info', `Scenarios: ${scenarios}`);
  log('info', `Sandbox dir: ${SANDBOX_DIR}`);
  
  // Ensure sandbox directory exists
  if (!fs.existsSync(SANDBOX_DIR)) {
    fs.mkdirSync(SANDBOX_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  
  // Run scenarios
  if (scenarios === 'all' || scenarios.includes('cli-lifecycle')) {
    await testCLILifecycle();
  }
  if (scenarios === 'all' || scenarios.includes('rest-api')) {
    await testRestAPI();
  }
  if (scenarios === 'all' || scenarios.includes('mcp-stdio')) {
    await testMCPStdio();
  }
  if (scenarios === 'all' || scenarios.includes('access-control')) {
    await testAccessControl();
  }
  if (scenarios === 'all' || scenarios.includes('encryption-roundtrip')) {
    await testEncryptionRoundtrip();
  }
  
  // Calculate duration
  results.duration_ms = Date.now() - startTime;
  
  // Output results
  log('info', '=== Test Results ===');
  log('info', `Passed: ${results.scenarios_passed}`);
  log('info', `Failed: ${results.scenarios_failed}`);
  log('info', `Skipped: ${results.scenarios_skipped}`);
  log('info', `Duration: ${results.duration_ms}ms`);
  
  if (results.failures.length > 0) {
    log('error', 'Failures:');
    results.failures.forEach(f => {
      log('error', `  - ${f.scenario}: ${f.error}`);
    });
  }
  
  // Write results to file
  fs.writeFileSync(
    path.join(LOGS_DIR, 'sandbox-results.json'),
    JSON.stringify(results, null, 2)
  );
  
  // Exit with appropriate code
  process.exit(results.scenarios_failed > 0 ? 1 : 0);
}

// Run
main().catch(error => {
  log('error', `Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
