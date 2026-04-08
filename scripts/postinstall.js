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

   Vault location:

     ~/  or  /        ->  Global vault  (shared across all projects)
     any folder       ->  Project vault (named after the folder)
                          You can rename it anytime with: envcp vault rename [name]

   ─────────────────────────────────────────────

   Get started:

     Simple (one-time setup):
       $ envcp init                        # Interactive guided setup

     Advanced (manual config):
       $ envcp init --advanced             # Full config options
       $ envcp add [NAME] [VALUE]          # Add a secret manually

     Explore:
       $ envcp --help                      # See all commands

   Docs: https://github.com/fentz26/EnvCP
`;

console.log(message);
