# SmartRPD Project Alignment Meeting

## Meeting Objective

Agree on SmartRPD's intended status, approved use and path forward so that the project team gives Security, IT and governance stakeholders one consistent answer.

The meeting must decide whether SmartRPD is:

1. **Research / proof of concept only** - used in a controlled evaluation, not relied upon for routine patient care or operational service delivery.
2. **Pilot / limited production** - used by a defined group for a controlled operational workflow, with formal support, security and governance conditions.
3. **Production system** - approved for routine operational use with accountable owners, support arrangements and full security and lifecycle controls.

Do not choose the label based only on how mature the software feels. The decision should be based on its actual intended use, users, operational dependency, data handling, support obligations and governance approval.

## Required Decisions

By the end of the meeting, record agreement on:

- Project classification: research, pilot/limited production, or production.
- Current permitted use and activities that are explicitly out of scope.
- Whether SmartRPD output is used for research evaluation, design assistance, clinical decision-making, manufacturing, or routine service delivery.
- Named Business Owner, System Owner, Technical Owner and Security/Governance contact.
- Intended users, estimated user count, administrator count and participating departments.
- Data classification and permitted data: anonymised dental scans and anonymised case identifiers only, unless governance approves otherwise.
- Whether patient information, clinical notes, treatment information or re-identification keys are prohibited.
- Whether the current GitHub Pages and GCP architecture is accepted for the agreed classification.
- Security gaps that must be resolved before pilot or production approval.
- Required documents, evidence, owners and target dates for submission.

## Suggested 60-Minute Agenda

| Time | Topic | Expected outcome |
|---|---|---|
| 0-5 min | Purpose and current situation | Confirm why alignment and renewed security review are required |
| 5-15 min | Intended use and project classification | Agree on research, pilot or production direction |
| 15-25 min | Users, workflow and operational dependency | Confirm who uses it, for what, and consequences if unavailable or incorrect |
| 25-35 min | Data scope and patient involvement | Confirm anonymisation, prohibited information and retention expectations |
| 35-45 min | Architecture and security controls | Review frontend, API, firewall, access control, MySQL and network allowlisting |
| 45-55 min | Gaps, evidence and ownership | Assign each unanswered security/governance item to an owner |
| 55-60 min | Decision recap and next actions | Read back decisions, deadlines and escalation needs |

## Discussion Points

### 1. Why SmartRPD Exists

- What business or research problem does SmartRPD solve?
- What is the intended outcome: evaluation, process improvement, operational use, manufacturing support, or clinical support?
- Which current features were included in the previous SRB approval?
- Which new or changed features triggered the updated review?
- What evidence will demonstrate that the project has achieved its objective?

### 2. Research Versus Production

Ask these questions directly:

- Will staff use SmartRPD as part of routine work rather than a time-limited study?
- Will users depend on its availability to complete actual cases?
- Will outputs be used to make, approve or manufacture an item for a real patient?
- Is there a defined study protocol, research approval, study population, end date and research investigator?
- Is the software described to users as experimental or operational?
- Are support, incident response, backup, recovery, change control and patching expected?
- Will the system continue after the research or evaluation period?

If it is used routinely for real operational cases, calling it “research” alone may not accurately describe the risk or governance obligations. If the direction remains uncertain, propose a **controlled pilot** with defined users, scope, duration, entry criteria and exit criteria instead of forcing a premature research-or-production label.

### 3. Patient and Data Involvement

Current stated scope for confirmation:

- Dental scans are anonymised before upload.
- Cases use anonymised identifiers.
- No patient name, NRIC, date of birth, medical record number or contact information is stored.
- No clinical notes, treatment information or patient-linked annotations are stored.
- SmartRPD does not retain a re-identification key.
- SmartRPD does not perform AI processing.

Questions to resolve:

- Who performs anonymisation, at what stage, and using what written procedure?
- How is anonymisation checked before upload?
- Can file names, image metadata, STL metadata or free-text fields accidentally contain identifiers?
- Is any mapping from SmartRPD case ID to a patient held elsewhere, and who controls it?
- What file types are permitted and what validation is applied?
- What are the retention and deletion periods for case records and files?
- Can users export or download information, and where may it be stored afterward?

### 4. Users, Administrators and Authentication

Confirm and document:

- Number and type of standard users.
- Number of administrators; keep this to the minimum required.
- Who approves account creation, role changes and deactivation.
- Whether accounts are individual and whether shared accounts are prohibited.
- Current login method: assigned username and password.
- Password policy, password storage method, reset process and lockout controls.
- Whether MFA is required for the agreed project classification.
- User access review frequency.
- Administrator activity logging and review.
- Offboarding process when staff leave the project or department.

### 5. Architecture and Network Flow

Use the updated architecture diagram to explain one end-to-end flow:

1. An authorised user accesses the static SmartRPD frontend at `https://ndcs-smartrpd.github.io/tmp.rpd/`.
2. GitHub Pages serves only the frontend HTML, CSS and JavaScript; it does not host the API or MySQL database.
3. The browser calls `https://live.api.smartrpdai.com/api/smartrpd/*` over HTTPS/TLS on TCP 443.
4. Enterprise network security permits only the required frontend and API destinations.
5. The GCP HTTPS Load Balancer and Cloud Armor form the public firewall/filtering layer.
6. The private GCP API server performs authentication, role checks, workflow and file operations.
7. The API communicates with MySQL at private address `10.148.0.3:3306`; users and browsers do not connect directly to MySQL.

Confirm whether Security requires:

- Exact frontend and API URL allowlisting.
- Browser methods `GET`, `POST` and CORS preflight `OPTIONS`.
- Cloud Armor rule export or screenshots.
- GCP VPC/firewall evidence for private API-to-MySQL access.
- TLS certificate and renewal evidence.
- Network, application and database logging evidence.

### 6. Known Configuration Item

The reviewed API source snapshot uses an explicit CORS origin allowlist but does not include the current frontend origin `https://ndcs-smartrpd.github.io`.

Before representing this as resolved, the Technical Owner should:

- Confirm the configuration running in production.
- Add the exact current frontend origin if it is absent.
- Retain older GitHub origins only if still required.
- Test login, viewing, upload and download from the approved network.
- Save configuration and test evidence for Security.

### 7. Operational and Security Readiness

For pilot or production, confirm the owner and evidence for:

- Monitoring dashboards, alert thresholds and notification recipients.
- Security logging and log-retention period.
- Incident reporting, triage and escalation.
- Backup frequency, retention, encryption and restore testing.
- Operating-system, Node.js dependency and MySQL patching.
- Vulnerability scanning, remediation timelines and exception handling.
- Source-code review, dependency audit, SAST and DAST expectations.
- Release approval, deployment records and rollback procedure.
- Business continuity, recovery objectives and acceptable downtime.
- User support contact and service hours.
- Periodic access review.
- Data retention and secure deletion.
- End-of-project or system-decommissioning process.

## Material to Prepare Before the Meeting

### Essential

- One-page project summary: problem, purpose, users, current status and requested approval.
- Updated architecture diagram.
- List of old versus new features since the previous SRB approval.
- End-to-end workflow from anonymisation through upload, viewing, processing, download and deletion.
- Current frontend and API URLs.
- Permitted file-type and extension list.
- User and administrator numbers, roles and access-approval process.
- Data inventory and data-flow description.
- Anonymisation procedure and responsible role.
- Previous SRB approval and previously submitted security documents.
- List of open questions with a named decision owner.

### Technical Evidence

- GitHub repository ownership and access list.
- GitHub Pages deployment configuration and change history.
- GCP project, region, VM and network inventory.
- Load balancer, TLS certificate and Cloud Armor evidence.
- GCP firewall/VPC rules, especially API-to-MySQL TCP 3306.
- Production CORS configuration.
- Authentication and administrator-role evidence.
- Logging and monitoring screenshots or exports.
- Backup policy and latest restore-test result.
- Patch and vulnerability reports.
- Latest dependency audit, security testing and remediation status.

### Governance Evidence

- Research protocol and ethics/research approval, if claiming research use.
- Pilot charter, permitted users, duration and success/exit criteria, if proposing a pilot.
- Business and system ownership acceptance, if proposing production.
- Data classification confirmation from the appropriate governance owner.
- Privacy/data-protection assessment or written confirmation that anonymised data is outside PII/SHI scope.
- Risk register with treatment owner and due date for each open risk.

## Questions to Send Security Before the Meeting

- Which approval route applies to research, pilot and production systems?
- What evidence is mandatory for each route?
- Is GitHub Pages permitted for this static frontend under the proposed use?
- Must the frontend and API be separately allowlisted?
- What minimum authentication and MFA requirements apply?
- What vulnerability scanning, penetration testing, SAST and DAST evidence is required?
- What logging, monitoring, retention, incident response and backup evidence is required?
- Is a formal privacy or data-classification assessment required even when all scans are anonymised?
- Are there specific cloud, database, patching or recovery standards the team must demonstrate?
- Which findings are approval blockers and which may be tracked as post-approval actions?

## Suggested Decision Record

Complete this during the meeting:

| Decision | Agreed position | Owner | Due date |
|---|---|---|---|
| Project classification | Research / pilot / production |  |  |
| Approved purpose |  |  |  |
| Approved users and administrators |  |  |  |
| Approved data scope |  |  |  |
| Prohibited data and uses |  |  |  |
| Hosting and architecture acceptance |  |  |  |
| Authentication and MFA position |  |  |  |
| Security testing required |  |  |  |
| Monitoring, patching and support owners |  |  |  |
| Submission documents and deadline |  |  |  |

## Recommended Closing Statement

“The team agrees that SmartRPD will be treated as **[research / controlled pilot / production]** for **[defined purpose]**, used only by **[defined users]**, and limited to **anonymised dental scans and anonymised case identifiers**. The named owners will close the recorded security and governance actions before the agreed approval or go-live point. Any change to patient-data scope, intended use, hosting, integrations or user population will be submitted for review before implementation.”
