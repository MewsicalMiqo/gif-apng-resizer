# GIF/APNG Resizer Web App

A lightweight browser-based tool to resize uploaded PNG/GIF images, preview outputs, and download converted files.

## Basic Function

- Upload or drag-and-drop a `.png` or `.gif`.
- Preview the original image.
- Generate resized outputs at:
  - `112x112`
  - `128x128`
- Output format for `112` and `128` matches input type:
  - PNG input -> PNG outputs
  - GIF input -> animated GIF outputs
- Generate an APNG at the largest possible square resolution up to `320px` while keeping file size at or below `512KB` when possible.
- Preview processed outputs and save each file with a download button.

## File Naming

Downloaded files use the original uploaded filename plus a size suffix:

- `<original-name>-112.<ext>`
- `<original-name>-128.<ext>`
- `<original-name>-<apng-size>.apng`

Example: `logo.gif` -> `logo-112.gif`, `logo-128.gif`, `logo-320.apng`

## Dependencies

This app is dependency-light and runs in the browser with vendored libraries in `vendor/`:

- `UPNG.js` (`vendor/UPNG.min.js`)
  - Encodes APNG output.
- `pako` (`vendor/pako.min.js`)
  - Compression dependency used by UPNG.
- `omggif` (`vendor/omggif.js`)
  - Decodes GIF frames and encodes resized GIF outputs.

## Run Locally

Use any static server and open `index.html`.

Example with Node.js:

```bash
node -e "const http=require('http');const fs=require('fs');const path=require('path');const root=process.cwd();const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.gif':'image/gif','.apng':'image/apng','.json':'application/json','.ico':'image/x-icon'};http.createServer((req,res)=>{let reqPath=decodeURIComponent((req.url||'/').split('?')[0]);if(reqPath==='/') reqPath='/index.html';const filePath=path.join(root,reqPath.replace(/^\//,''));if(!filePath.startsWith(root)){res.writeHead(403);res.end('Forbidden');return;}fs.readFile(filePath,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return;}const ext=path.extname(filePath).toLowerCase();res.writeHead(200,{'Content-Type':mime[ext]||'application/octet-stream'});res.end(data);});}).listen(5173,()=>console.log('Server running at http://localhost:5173'));"
```

Then open: `http://localhost:5173`

