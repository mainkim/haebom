import { defineConfig } from "@apps-in-toss/web-framework/config";

/**
 * Apps in Toss SDK 3.x config.
 * granite.config.ts was renamed to apps-in-toss.config.ts.
 * https://developers-apps-in-toss.toss.im/documentation/api-and-sdk-en/integration/sdk-3.x
 *
 * appName must match the console. Override with HAEBOM_AIT_APP_NAME.
 * No ads in this submission.
 */
const appName = process.env.HAEBOM_AIT_APP_NAME?.trim() || "haebom";

export default defineConfig({
  appName,
  brand: {
    primaryColor: "#316BFF"
  },
  webView: {},
  permissions: [],
  webBundleDir: "dist"
});
