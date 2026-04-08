# EnvCP Wiki Content

This directory contains all the markdown files for the EnvCP GitHub wiki.

## Wiki Pages Prepared

- `Home.md` - Main wiki landing page
- `Installation.md` - Installation guide
- `Quick-Start-Guide.md` - Quick start guide
- `Configuration-Reference.md` - Complete configuration reference
- `MCP-Integration.md` - MCP integration guide
- `CLI-Reference.md` - CLI command reference
- `Security-Best-Practices.md` - Security best practices
- `Troubleshooting.md` - Troubleshooting guide

## How to Publish to GitHub Wiki

GitHub wikis need to be initialized through the web interface first, then you can clone and push content.

### Option 1: Manual Upload (Easiest)

1. **Go to the wiki**: https://github.com/fentz26/EnvCP/wiki

2. **Create the first page**:
   - Click "Create the first page"
   - Title: `Home`
   - Copy and paste content from `Home.md`
   - Click "Save Page"

3. **Create additional pages**:
   - Click "New Page" for each remaining file
   - Use the filename (without .md) as the page title
   - Copy and paste the content
   - Click "Save Page"

**Page titles** (use these exact titles for proper linking):
- `Home`
- `Installation`
- `Quick-Start-Guide`
- `Configuration-Reference`
- `MCP-Integration`
- `CLI-Reference`
- `Security-Best-Practices`
- `Troubleshooting`

### Option 2: Clone and Push (Advanced)

After creating the first page via web UI:

```bash
# Clone the wiki repository
cd /tmp
git clone https://github.com/fentz26/EnvCP.wiki.git

# Copy all markdown files
cp /home/fentz/EnvCP/wiki-content/*.md EnvCP.wiki/

# Commit and push
cd EnvCP.wiki
git add .
git commit -m "Add comprehensive wiki documentation"
git push origin master
```

### Option 3: Using gh CLI (Recommended if Available)

GitHub CLI doesn't directly support wiki operations, so we'll need to use git method after initial page creation.

## Wiki Structure

The wiki is organized as follows:

```
Home (landing page)
├── Getting Started
│   ├── Installation
│   ├── Quick Start Guide
│   └── Configuration Reference
│
├── Platform Integration
│   └── MCP Integration
│
├── Reference
│   ├── CLI Reference
│   └── Configuration Reference
│
└── Advanced
    ├── Security Best Practices
    └── Troubleshooting
```

## Updating the Wiki

To update wiki content:

1. Edit the markdown files in this directory
2. Copy updated content to the wiki (manual or git push)

## Links Between Pages

The wiki pages use relative links like:

```markdown
[Installation](Installation)
[Quick Start](Quick-Start-Guide)
```

Make sure to use the exact page titles (case-sensitive) for links to work.

## Next Steps

1. Go to https://github.com/fentz26/EnvCP/wiki
2. Create the Home page with content from `Home.md`
3. Create remaining pages using content from other .md files
4. Verify all internal links work

## Notes

- GitHub wiki page titles are case-sensitive
- Spaces in page titles are converted to dashes in URLs
- Use exact titles listed above for proper linking
- All markdown files are ready to copy/paste
