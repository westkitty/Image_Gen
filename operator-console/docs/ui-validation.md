# UI Validation Checks

To validate the UI and ensure the backend is untouched:

1. **Verify Backend**
   ```sh
   cd /Users/andrew/Image_Gen/sdcpp-workflow
   bin/sdcpp-verify.sh
   ```
   Must output `==== PASS ====`.

2. **Start the UI**
   ```sh
   cd /Users/andrew/Image_Gen/operator-console
   npm install
   node server.js
   ```

3. **Check Safety**
   - No `0.0.0.0` binding.
   - Access `http://127.0.0.1:31337/`
   - Run a "Verify" job through the UI Dashboard. Watch the Job Console stream output.
   - Confirm History populates from local Markdown logs.
