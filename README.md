# PR tree visualiser

<img width="1940" height="1264" alt="image" src="https://github.com/user-attachments/assets/f36536a2-9fba-4300-8b28-dca57ff4ecdf" />


## Auth

Create a classic GitHub Token at https://github.com/settings/tokens with most read accesses.

If this is an org with SSO, click "Configure SSO" next to the token afterwards to authorize it.

Then open .env and set: `GITHUB_TOKEN=ghp_xxxxxxxxxxxx`

## Run the project=

Setup : `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_SEARCH_QUERY`, `PORT=8030` values

Command to run it:

`cd "/PR-tree-localhost-app"`

```
node server.js
```
(or npm start) then open http://localhost:8030

## Tips

Launch it with a quick command in your terminal.

1. open `nano ~/.zshrc`

```
alias pr3="cd ~/Documents/<path-to-where-you-cloned-the-repo>/PR-tree-localhost-app && npm start"
```
and save

2. run `source ~/.zshrc`

3. run `pr3` in your terminal
