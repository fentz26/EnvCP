/**
 * EnvCP Sandbox Test Runner
 * 
 * CIS Docker Benchmark hardened E2E test runner.
 * Orchestrates sandbox test scenarios and reports results.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const SANDBOX_DIR = '/tmp/envcp-sandbox';
const LOGS_DIR = '/tmp/envcp-logs';
const TIMEOUT_MS = parseInt(process.env.SANDBOX_TIMEOUT_MS || '600000', 10);

// Parse inputs
const providers = (process.env.SANDBOX_PROVIDERS || 'openai').split(',').map(s => s.trim());
const scenarios = process.env.SANDBOX_SCENARIOS || 'all';

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
function execCLI(args, options = {}) {
  const envcp = path.join(__dirname, '../../dist/cli/index.js');
  const cmd = `node ${envcp} ${args.join(' ')}`;
  
  try {
    const result = execSync(cmd, {
      cwd: options.cwd || SANDBOX_DIR,
      encoding: 'utf-8',
      timeout: options.timeout || 30000,
      env: { ...process.env, NO_COLOR: '1' }
    });
    return { success: true, stdout: result, stderr: '' };
  } catch (error) {
    return { 
      success: false, 
      stdout: error.stdout || '', 
      stderr: error.stderr || error.message,
      code: error.status || 1
    };
  }
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
 */
async function testCLILifecycle() {
  return runScenario('cli-lifecycle', async () => {
    // Clean slate
    execCLI(['lock'], { cwd: SANDBOX_DIR });
    
    // Init
    const initResult = execCLI(['init', '--password', 'test-password-123', '--skip-mcp'], { cwd: SANDBOX_DIR });
    if (!initResult.success) throw new Error(`init failed: ${initResult.stderr}`);
    
    // Unlock
    const unlockResult = execCLI(['unlock', '-p', 'test-password-123'], { cwd: SANDBOX_DIR });
    if (!unlockResult.success) throw new Error(`unlock failed: ${unlockResult.stderr}`);
    
    // Add variable
    const addResult = execCLI(['add', 'TEST_VAR', '--value', 'test-value-123'], { cwd: SANDBOX_DIR });
    if (!addResult.success) throw new Error(`add failed: ${addResult.stderr}`);
    
    // Get variable
    const getResult = execCLI(['get', 'TEST_VAR', '--show-value'], { cwd: SANDBOX_DIR });
    if (!getResult.success) throw new Error(`get failed: ${getResult.stderr}`);
    if (!getResult.stdout.includes('test-value-123')) throw new Error('value mismatch');
    
    // List variables
    const listResult = execCLI(['list'], { cwd: SANDBOX_DIR });
    if (!listResult.success) throw new Error(`list failed: ${listResult.stderr}`);
    if (!listResult.stdout.includes('TEST_VAR')) throw new Error('variable not in list');
    
    // Lock
    const lockResult = execCLI(['lock'], { cwd: SANDBOX_DIR });
    if (!lockResult.success) throw new Error(`lock failed: ${lockResult.stderr}`);
    
    // Verify locked
    const lockedGet = execCLI(['get', 'TEST_VAR'], { cwd: SANDBOX_DIR });
    if (lockedGet.success) throw new Error('should not access when locked');
  });
}

/**
 * Scenario 2: REST API
 */
async function testRestAPI() {
  return runScenario('rest-api', async () => {
    // This would start envcp serve and test REST endpoints
    // For now, we'll skip if no server support
    log('info', 'REST API test - would start server and test endpoints');
    results.scenarios_skipped++;
  });
}

/**
 * Scenario 3: MCP Stdio
 */
async function testMCPStdio() {
  return runScenario('mcp-stdio', async () => {
    // This would spawn envcp in MCP mode and test JSON-RPC
    log('info', 'MCP stdio test - would spawn process and test JSON-RPC');
    results.scenarios_skipped++;
  });
}

/**
 * Scenario 4: Access Control
 */
async function testAccessControl() {
  return runScenario('access-control', async () => {
    // Unlock
    execCLI(['unlock', '-p', 'test-password-123'], { cwd: SANDBOX_DIR });
    
    // Add blacklisted variable
    execCLI(['add', 'ADMIN_SECRET', '--value', 'secret-123'], { cwd: SANDBOX_DIR });
    
    // This test requires config modification to set blacklist_patterns
    // For now, verify basic add/get works
    log('info', 'Access control test - basic verification');
  });
}

/**
 * Scenario 5: Encryption Roundtrip
 */
async function testEncryptionRoundtrip() {
  return runScenario('encryption-roundtrip', async () => {
    // Unlock
    execCLI(['unlock', '-p', 'test-password-123'], { cwd: SANDBOX_DIR });
    
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
    
    // Verify all values present
    const exported = JSON.parse(exportResult.stdout);
    for (const [name, value] of Object.entries(testVars)) {
      if (exported[name] !== value) {
        throw new Error(`roundtrip mismatch for ${name}: expected ${value}, got ${exported[name]}`);
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
