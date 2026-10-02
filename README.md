# Code Fossil — local Git analysis

## Start the app

The easiest option is to double-click `start.bat`. It starts the local server and keeps the terminal open.

Or open PowerShell in this folder and run:

```powershell
node server.js
```

Then open <http://localhost:4173> in your browser. Keep the terminal open while using the app.

## Analyze a repository

Click **Load repository**, then enter either:

- A local path containing a `.git` folder, such as `C:\\dev\\payments-api`
- A Git URL, such as `https://github.com/example/payments-api.git`

The backend reads real history with Git and calculates commit timeline events, changed-file churn, bug-fix density, co-change coupling, file age, and scar-tissue risk. Remote URLs are shallow-cloned into the system temporary directory before analysis.

## Requirements

- Node.js 18+
- Git installed and available on `PATH`
- Network access only when analyzing a remote Git URL
