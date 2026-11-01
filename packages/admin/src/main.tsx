import type { AdminConfig } from "patcms/advanced"
import { CONFIG_SCHEMA_VERSION } from "patcms/advanced"
import { mountAdmin } from "./admin/mount"
import "./styles/tokens.css"

/**
 * Standalone admin dev entry. A real host supplies its generated config and
 * repository target (playground does this in P1; yve does it at P6). This file
 * stays deliberately empty so no fixture data leaks into the shipped shell.
 */
const rootEl = document.getElementById("root")
if (rootEl === null) {
  const message = "root host element missing"
  throw new Error(message)
}

const emptyConfig: AdminConfig = {
  schemaVersion: CONFIG_SCHEMA_VERSION,
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [],
}

mountAdmin(rootEl, {
  config: emptyConfig,
  support: { name: "Ing" },
  repository: {
    owner: "your-github-name",
    repo: "your-site-content",
    branch: "your-branch",
  },
})
