#!/bin/bash

# Wiki to MDX conversion script
# Converts wiki markdown files to Mintlify MDX format

WIKI_DIR="/home/fentz/EnvCP/wiki-content"
DOCS_DIR="/home/fentz/EnvCP/docs"

# Mapping of wiki files to docs locations
declare -A file_map=(
  ["Home.md"]="index.mdx"
  ["Installation.md"]="installation.mdx"
  ["Quick-Start-Guide.md"]="quick-start.mdx"
  ["CLI-Reference.md"]="cli-reference/commands.mdx"
  ["Configuration-Reference.md"]="configuration/reference.mdx"
  ["MCP-Integration.md"]="integrations/mcp.mdx"
  ["OpenAI-Integration.md"]="integrations/openai.mdx"
  ["Gemini-Integration.md"]="integrations/gemini.mdx"
  ["Local-LLM-Integration.md"]="integrations/local-llm.mdx"
  ["API-Reference.md"]="api-reference/endpoints.mdx"
  ["Security-Best-Practices.md"]="security/best-practices.mdx"
  ["Session-Management.md"]="advanced/session-management.mdx"
  ["Troubleshooting.md"]="advanced/troubleshooting.mdx"
)

convert_file() {
  local input_file="$1"
  local output_file="$2"
  local filename=$(basename "$input_file")
  
  # Add frontmatter based on file
  local title="${filename%.md}"
  title="${title//-/ }"
  title="${title//_/ }"
  
  # Extract first heading as title
  local first_heading=$(grep -m 1 "^# " "$input_file" | sed 's/^# //')
  if [ -n "$first_heading" ]; then
    title="$first_heading"
  fi
  
  # Create temp file with frontmatter
  echo "---" > /tmp/temp_mdx.mdx
  echo "title: $title" >> /tmp/temp_mdx.mdx
  echo "---" >> /tmp/temp_mdx.mdx
  echo "" >> /tmp/temp_mdx.mdx
  
  # Convert wiki-specific markdown to MDX
  cat "$input_file" | \
    # Convert wiki links to docs links
    sed 's/\[Installation\](Installation)/[Installation](\/installation)/g' | \
    sed 's/\[Quick Start Guide\](Quick-Start-Guide)/[Quick Start Guide](\/quick-start)/g' | \
    sed 's/\[Configuration\](Configuration)/[Configuration](\/configuration\/reference)/g' | \
    sed 's/\[MCP Integration\](MCP-Integration)/[MCP Integration](\/integrations\/mcp)/g' | \
    sed 's/\[OpenAI Integration\](OpenAI-Integration)/[OpenAI Integration](\/integrations\/openai)/g' | \
    sed 's/\[Gemini Integration\](Gemini-Integration)/[Gemini Integration](\/integrations\/gemini)/g' | \
    sed 's/\[Local LLM Integration\](Local-LLM-Integration)/[Local LLM Integration](\/integrations\/local-llm)/g' | \
    sed 's/\[Security Best Practices\](Security-Best-Practices)/[Security Best Practices](\/security\/best-practices)/g' | \
    sed 's/\[Session Management\](Session-Management)/[Session Management](\/advanced\/session-management)/g' | \
    sed 's/\[Troubleshooting\](Troubleshooting)/[Troubleshooting](\/advanced\/troubleshooting)/g' | \
    sed 's/\[CLI Reference\](CLI-Reference)/[CLI Reference](\/cli-reference\/commands)/g' | \
    sed 's/\[Configuration Reference\](Configuration-Reference)/[Configuration Reference](\/configuration\/reference)/g' | \
    sed 's/\[API Reference\](API-Reference)/[API Reference](\/api-reference\/endpoints)/g' \
    >> /tmp/temp_mdx.mdx
  
  # Remove first heading if it matches title (to avoid duplication)
  if [ "$(head -n 4 /tmp/temp_mdx.mdx | tail -n 1 | sed 's/^# //')" = "$title" ]; then
    # Remove the duplicate heading
    sed -i '4d' /tmp/temp_mdx.mdx
  fi
  
  # Move to final location
  mkdir -p "$(dirname "$output_file")"
  cp /tmp/temp_mdx.mdx "$output_file"
  
  echo "Converted: $input_file → $output_file"
}

# Convert all files
for wiki_file in "${!file_map[@]}"; do
  input_path="$WIKI_DIR/$wiki_file"
  output_path="$DOCS_DIR/${file_map[$wiki_file]}"
  
  if [ -f "$input_path" ]; then
    convert_file "$input_path" "$output_path"
  else
    echo "Warning: $input_path not found"
  fi
done

echo "✓ Conversion complete!"
