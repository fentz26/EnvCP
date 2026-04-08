#!/usr/bin/env node

const message = `
   ███████╗███╗   ██╗██╗   ██╗ ██████╗██████╗
   ██╔════╝████╗  ██║██║   ██║██╔════╝██╔══██╗
   █████╗  ██╔██╗ ██║██║   ██║██║     ██████╔╝
   ██╔══╝  ██║╚██╗██║╚██╗ ██╔╝██║     ██╔═══╝
   ███████╗██║ ╚████║ ╚████╔╝ ╚██████╗██║
   ╚══════╝╚═╝  ╚═══╝  ╚═══╝   ╚═════╝╚═╝

   Thanks for installing EnvCP!
   Keep your secrets safe from AI agents.

   ─────────────────────────────────────────────

   Setup options:

     Simple (one-time setup):
       $ envcp init           # Interactive guided setup

     Advanced (manual config):
       $ envcp init --advanced   # Full config options
       $ envcp add KEY           # Add a secret manually
       $ envcp config set KEY VALUE  # Set config values

     Explore:
       $ envcp --help         # See all commands

   Docs: https://github.com/fentz26/EnvCP
`;

console.log(message);
