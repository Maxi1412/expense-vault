# GitHub Pages deployment notes

Use this when the GitHub repository is ready.

1. Put the contents of this folder in the repository root.
2. Commit and push the files.
3. In GitHub, open **Settings > Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the production branch (normally `main`) and `/ (root)`, then save.
6. Open the HTTPS GitHub Pages address on the phone.
7. In Chrome, use **Add to Home screen / Install app** when available.

No secret, API key or server environment variable is required.

The app data lives in IndexedDB for that exact installed website origin. GitHub hosts the code; it does not contain the user's expense database.