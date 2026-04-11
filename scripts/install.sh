#!/bin/bash

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}${BLUE}"
cat << "EOF"
  ███████╗███╗   ██╗██╗   ██╗ ██████╗██████╗                 
  ██╔════╝████╗  ██║██║   ██║██╔════╝██╔══██╗                
  █████╗  ██╔██╗ ██║██║   ██║██║     ██████╔╝                
  ██╔══╝  ██║╚██╗██║╚██╗ ██╔╝██║     ██╔═══╝                 
  ███████╗██║ ╚████║ ╚████╔╝ ╚██████╗██║                     
  ╚══════╝╚═╝  ╚═══╝  ╚═══╝   ╚═════╝╚═╝                     
EOF
echo -e "${NC}"

echo -e "${BLUE}Installing EnvCP...${NC}"
echo ""

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed.${NC}"
    echo "Please install Node.js first: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -e "console.log(process.version.slice(1).split('.')[0])")
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18 or higher is required (you have $NODE_VERSION).${NC}"
    exit 1
fi

echo -e "${BLUE}Installing @fentz26/envcp globally...${NC}"

if npm install -g @fentz26/envcp; then
    echo ""
    echo -e "${GREEN}${BOLD}Successfully installed EnvCP!${NC}"
    echo ""
    echo -e "${BOLD}Get started:${NC}"
    echo "  envcp init         # Initialize configuration"
    echo "  envcp add KEY      # Add a secret"
    echo "  envcp --help       # See all commands"
    echo ""
    echo -e "${BOLD}Docs:${NC} https://envcp.org"
else
    echo ""
    echo -e "${RED}Installation failed. Try with sudo:${NC}"
    echo "  curl -fsSL https://raw.githubusercontent.com/fentz26/EnvCP/main/scripts/install.sh | sudo bash"
    exit 1
fi
