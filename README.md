# cfnew-core-update

Automatic verified cfnew core updates for an existing Cloudflare Pages project.

This repository keeps the existing Direct Upload project `cfnew-backup` (`https://cfnew-backup.pages.dev`) on the official `byJoey/cfnew` release. It uploads a checked `_worker.js` folder with Wrangler. It does not create a project, and it does not change the project name, production branch, environment variables, KV binding, compatibility date, DNS, SSL, or KV data.

Scheduled deploys stay off until the Actions variable `AUTO_UPDATE_ENABLED` is exactly `true`. Set that only after a manual production deploy and a dashboard check. The Chinese runbook is [docs/操作说明.md](docs/操作说明.md).

The separate panel fork is out of scope. This repo does not repair Loon output and does not sync that fork.
