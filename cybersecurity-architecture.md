# SmartRPD Cybersecurity Approval Architecture

## Purpose

This companion note explains the approval-focused diagram in `cybersecurity-architecture.html`. It separates the public frontend, public API edge, private application tier and private data tier, while showing the exact browser-to-API dependency that must be permitted.

## Required URLs

- Frontend user interface: `https://ndcs-smartrpd.github.io/tmp.rpd/*`
- SmartRPD API: `https://live.api.smartrpdai.com/api/smartrpd/*`
- Browser methods used by the application: `GET`, `POST` and CORS preflight `OPTIONS`

Whitelisting only the GitHub Pages URL is insufficient. GitHub Pages delivers static HTML, CSS and JavaScript; the user's browser then calls the GCP API directly for login, case data, 3D files, upload and download.

## Confirmed Architecture

- GitHub repository and GitHub Actions manage the frontend source and static deployment.
- GitHub Pages hosts the browser user interface only; it does not host the API or database.
- API traffic uses HTTPS to `live.api.smartrpdai.com` through the GCP external Application Load Balancer.
- TLS terminates at the load balancer, with Cloud Armor attached at the public edge.
- The SmartRPD Node.js/Express API runs on a private GCP VM at `10.148.0.2`.
- MySQL runs on a private GCP VM at `10.148.0.3:3306`; there is no browser-to-database path.
- Approved anonymised STL and image objects are stored in `gs://rpdcloudstorage` in Singapore, with application metadata in MySQL.
- The approved operating scope is anonymised dental scans and anonymised case identifiers only. Patient-identifiable information and clinical notes are not permitted.

## CORS Finding and Required Change

The reviewed API snapshot implements an explicit CORS origin allowlist, but currently lists:

- `https://faid123.github.io`
- `https://zscmngykx.github.io`
- `http://localhost:8089` for local development

It does not list the current frontend origin `https://ndcs-smartrpd.github.io`. This mismatch can cause browser preflight or API requests to fail even when both URLs are reachable through the enterprise firewall.

Required action: add the exact origin `https://ndcs-smartrpd.github.io` to the production API CORS allowlist. CORS origins contain only scheme and host; do not include `/tmp.rpd/` or a trailing wildcard. Retain or remove the older origins only after confirming whether they remain in use.

## Security Control Responsibilities

| Layer | Control | Approval interpretation |
|---|---|---|
| Enterprise web filtering | Allow the two exact SmartRPD destinations | Enables frontend loading and browser-to-API traffic without allowing all GitHub Pages sites |
| TLS | HTTPS certificate at the GCP load balancer | Protects frontend/API traffic in transit |
| Public API edge | Cloud Armor and load-balancer rules | Filters inbound API traffic before the private backend |
| Application | CORS, authentication, role checks, request validation | CORS restricts browser origins; authentication and authorisation still make the access decision |
| Database | Private IP and TCP 3306 internal-only | Prevents direct browser or public database access |
| Data governance | Anonymisation before upload and approved file types | Keeps PII/SHI outside the approved SmartRPD scope |
| Operations | Logging, monitoring, backup, patch and vulnerability processes | Owners and evidence should be attached to the cybersecurity submission |

## Evidence to Attach or Confirm

- Export or screenshot of the active Cloud Armor rules and review date.
- Production CORS configuration after adding the current frontend origin.
- GCP firewall/VPC rule showing MySQL TCP 3306 is allowed only from the API tier.
- TLS certificate status and renewal ownership.
- Monitoring dashboards, alert recipients, log-retention period and incident-response owner.
- Operating-system, Node.js dependency and MySQL patch cadence, including emergency patch process.
- Vulnerability scanning cadence and remediation service levels; current repository automation confirms lint, tests, build and dependency-audit reporting, but formal SAST/DAST blocking gates are not confirmed.
- Backup retention and restore-test evidence.
