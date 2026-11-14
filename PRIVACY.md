# Privacy Policy — PageCraft

*Last updated: November 14, 2026*

**PageCraft** ("AI Webpage Customizer & Userscript Studio" — official website: [https://pagecraft.shenxin.space](https://pagecraft.shenxin.space)) helps you customize webpage layouts, remove popups and distractions, export tables, and generate persistent CSS tweaks or JavaScript userscripts using natural language.

## 1. Zero Background Tracking

PageCraft **does NOT**:
- Record your browsing history, visited URLs, search queries, or tab switches in the background;
- Inject passive tracking scripts onto every website;
- Capture keystrokes, form inputs, passwords, cookies, or clipboard contents;
- Sell, rent, or share personal data with advertisers or data brokers.

## 2. Data Stored Locally in Your Browser

The following data stays locally inside your browser (`chrome.storage.local`) and never leaves your device unless you explicitly export it:
- Your saved CSS modifications and JavaScript userscripts (`pc_mods`);
- Your UI preferences (theme and language);
- Your custom AI API key (`ai.apiKey`), if you choose Bring-Your-Own-Key (BYOK) mode.

## 3. Optional Cloud AI Trial (`pagecraft.shenxin.space`)

To let new users try PageCraft immediately without configuring an API key, fresh installations receive **10 free cloud AI generations**:
- **Only** when you explicitly click **Generate** or **Refine** in Cloud Trial mode, PageCraft sends your text instruction, the current site's sanitized host/path hint, the redacted page title, structural page landmarks (headings, buttons, and containers), and the structural DOM snippet of any selected element to our Cloudflare Worker proxy (`https://pagecraft.shenxin.space/api/generate`), which forwards the request to our AI model provider to generate the CSS or JavaScript rule.
- All of these outbound context fields are automatically redacted client-side before leaving your browser for email addresses, long numeric IDs, API tokens (`sk-...` / `Bearer`), URL query strings, and password fields.
- Our server stores only a random anonymous installation identifier (`installId`), a hashed IP and daily capacity rate-limit counter (`rate_limits`), and aggregate token-count metrics (`install_quotas`, `llm_calls`) to enforce the 10-generation free quota and protect against automated abuse. **Your prompts, page titles, structural landmarks, and webpage snippets are never stored in our database.**

## 4. Bring Your Own Key (BYOK) Mode

When you configure your own API key (e.g., DeepSeek, SiliconFlow, OpenAI, or OpenRouter) in Settings, generation requests are sent **directly from your browser to your chosen AI provider** and do not pass through PageCraft servers.

## 5. Optional "Did it work?" Feedback

After you apply a generated mod, PageCraft asks whether it worked. **Only if you click** 👍 or 👎, it sends a single anonymous vote to `https://pagecraft.shenxin.space/api/feedback` containing nothing but these coarse values:
- the vote (`up` / `down`);
- the engine type (`css` / `js`);
- whether the cloud trial or your own key was used (`cloud` / `byok`);
- whether the mod came from a follow-up refinement (`true` / `false`);
- whether its target selector matched elements on the page (`hit` / `miss` / `na`).

The vote **never** includes the URL, website name, page content, your instruction, or the generated code. On our server it is immediately folded into a daily aggregate counter (`feedback_daily`) that has no installation identifier, so a vote cannot be linked back to you. The request is signed with your anonymous `installId` solely to throttle automated abuse (a per-install daily counter). We use these totals only to measure and improve how often generated mods work.

## 6. Permissions Justification

- `storage`: Saves your webpage mods and settings locally.
- `sidePanel`: Displays the PageCraft studio alongside the webpage you are customizing.
- `tabs` & `scripting` & `<all_urls>`: Applies your enabled CSS rules to matching websites and runs the visual Element Picker when you click "Pick Element".
- `userScripts`: Executes your enabled JavaScript userscripts in Chrome's isolated `USER_SCRIPT` world.

## 7. Contact & Deletion

Uninstalling PageCraft immediately deletes all local mods, settings, and keys stored in your browser. For privacy inquiries, deletion, or support requests, contact [botzgbj@gmail.com](mailto:botzgbj@gmail.com), open an issue on [GitHub Issues](https://github.com/botshen/plugin-radar/issues), or visit [https://pagecraft.shenxin.space](https://pagecraft.shenxin.space).
