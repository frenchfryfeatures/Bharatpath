# BharatPath third-party dependencies and access management

Reviewed: 18 November 2026. Scope: the current local repository, including uncommitted changes, web/admin portal, mobile app, backend and infrastructure definitions. This is a source-code inventory, not confirmation that each service is deployed or enabled in AWS. Versions in the appendix are manifest requirements, not necessarily the installed versions.

## External services and data flows

| Service/source | Purpose and data involved | Implementation status |
| --- | --- | --- |
| AWS Cognito | Candidate/business sign-in, verification, sessions and MFA; identity credentials and tokens | Real integration: Amplify on web, Cognito HTTP API on mobile, JWT/JWKS verification on backend. Candidate and business pools are separate. |
| AWS S3 | Resumes, organisation verification documents, interview audio, exports, course media, profile images and audit archives | Storage integration and bucket infrastructure exist; presigned upload/download URLs. LocalStack supports local AWS emulation. |
| AWS SQS | Background task queue used through Celery | Integration and queue/dead-letter queue infrastructure exist. |
| OpenAI | Resume structuring, optional scoring extraction, assistant planning, interview questions/evaluation | Real HTTP integrations; provider settings and credentials determine activation. May receive resume/profile text, assistant messages or interview content depending on the feature. No OpenAI SDK dependency is required: the code uses HTTP clients. |
| Amazon Bedrock | Alternative scoring extraction provider | Adapter exists; configuration-dependent. |
| Amazon Textract | OCR fallback for resumes whose text cannot be extracted locally | Adapter exists; configuration-dependent. Document content is processed by AWS when used. |
| Sarvam AI | Interview speech transcription and speech generation | Real HTTP integration; configuration-dependent. Voice recordings/text leave the backend when this provider is selected. |
| Twilio | SMS notifications | Real HTTP integration; configurable alongside disabled/stub modes. Receives destination phone number and message content when enabled. |
| Amazon SES | Email notifications | Integration and sender/domain infrastructure exist; configuration-dependent. Receives recipient and email content. |
| Expo Push Service | Mobile push delivery and delivery receipts | Backend HTTP integration exists; requires registered push tokens and working notification setup. |
| YouTube | Course lesson embeds | YouTube video IDs and privacy-enhanced `youtube-nocookie.com` embeds are supported. This is external video hosting, not a video generation service. |
| AWS infrastructure | EC2, optional RDS, VPC/security groups, IAM, EBS/EIP, Secrets Manager, SES DNS records and budgets | Terraform definitions exist. Their presence does not prove that every resource is deployed. |
| PostgreSQL and Redis | Application persistence, tenancy/security policies, caching and coordination | Local Docker definitions use PostgreSQL 16 and Redis 7; production Compose also defines these services. PostgreSQL can additionally be provisioned through RDS. |
| LocalStack and MailHog | Local AWS emulation and development email capture | Development Compose services; these are not production SaaS providers. |
| Docker Compose, Caddy and Terraform | Container orchestration, production reverse proxy/TLS and infrastructure provisioning | Deployment/development tooling defined in the repository. |
| Job and education taxonomy datasets | Onboarding classification options | Bundled `backend/data/job_taxonomy.json` and `education_taxonomy.csv`; education source metadata is retained. These are seed datasets, not live taxonomy APIs. The original datasets were supplied for this project; licensing/provenance needs its own review if redistributed. |
| General Sans, Inter, Space Mono and Noto fonts | Web/mobile typography and multilingual resume rendering | Bundled assets/font packages. Noto resume assets include an OFL file. This review does not certify rights for every font/image asset. |

Important implementation distinctions:

- Payments currently expose `none` and `stub` providers. A real Stripe/Razorpay payment gateway is not implemented by the inspected payment provider factory.
- Malware scanning is a hook, not a functioning scanner. `NullDocumentScanner` does not scan files; enabling scanning currently raises `NotImplementedError`. GuardDuty is described as the intended implementation, not an integrated service.
- Supabase, TanStack React Query and `@lucide/lab` are declared dependencies, but no application imports were found in the inspected TypeScript/TSX sources. Their presence in a manifest must not be interpreted as an active Supabase backend or active query client. Check before removing them, including build/config and dynamic use.
- Meeting links such as Google Meet are URL fields/examples; they do not establish a Google Calendar/Meet API integration.
- OpenTelemetry libraries are declared; an operational monitoring backend/export destination was not verified.

Evidence: `backend/app/settings.py`, `backend/app/core/auth/cognito.py`, `backend/app/core/storage.py`, `backend/app/core/openai_responses.py`, `backend/app/modules/{assistant,scoring,interview,resume,notifications,courses,billing}`, `infra/terraform`, `backend/docker-compose.yml`, `deploy/docker-compose.prod.yml`.

## Main application libraries

| Layer | Libraries and purpose |
| --- | --- |
| Web and admin portal | Next.js 16.3.4, React/React DOM 19.2.8; TypeScript; Tailwind CSS 4. Admin is part of the same frontend, not a separate application dependency manifest. |
| Web state and forms | Redux Toolkit, React Redux, React Hook Form, Zod and Hook Form resolvers; React Query is also declared. |
| Web authentication and UI | AWS Amplify, Lucide React icons, QRCode for MFA setup, libphonenumber-js for phone handling. |
| Mobile foundation | Expo SDK 54, React Native 0.81.5, React 19.1.0, Expo Router and React Navigation. React Native Web/React DOM support the web target. |
| Mobile UI and storage | AsyncStorage, safe-area context, screens, gesture handler, Reanimated/Worklets, SVG, WebView, Lucide, Phosphor and Expo/vector icons. |
| Mobile device features | Expo camera/audio, notifications, file system, document/image pickers, sharing, speech, haptics, linking/browser, fonts, assets, splash/status/system UI, blur and gradients. |
| Backend HTTP and validation | FastAPI, Uvicorn, Pydantic, pydantic-settings, python-multipart and HTTPX. |
| Backend database and jobs | SQLAlchemy, asyncpg, Alembic, Redis client, Celery with SQS support, boto3. |
| Backend document processing | pypdf, pypdfium2, Pillow, python-docx and Typst. |
| Backend security and observability | PyJWT with cryptographic support, structlog and OpenTelemetry. |
| Development and tests | ESLint, TypeScript, Babel; pytest, pytest-asyncio/cov, Hypothesis, Testcontainers, Schemathesis, Polyfactory, Ruff, mypy, import-linter and pre-commit. |

The complete declared direct dependencies and their version requirements are appended below. JavaScript lockfiles additionally contain transitive dependencies; these are not all separately authored integrations. This is not a vulnerability or licence certification. Backend Python requirements use ranges; no Python lockfile was found in the inspected project inventory.

## Role and access management

**Yes: the application implements role-based access control (RBAC), tenant isolation and additional business access gates.** Authentication is provided by Cognito, while application roles are resolved from BharatPath membership records, rather than trusting a role supplied by the browser.

| Account group | Backend roles | Access model |
| --- | --- | --- |
| Candidate/student | `CANDIDATE` | Own candidate profile, onboarding, resume and eligible candidate features. Candidate access is not an employer/college tenant membership. |
| Employer | `EMPLOYER_OWNER`, `EMPLOYER_RECRUITER`, `EMPLOYER_VIEWER` | Owner manages organisation/team and roles. Recruiter/viewer permissions are controlled by individual backend routes; portal entry alone does not grant every operation. |
| College/institute | `COLLEGE_ADMIN`, `COLLEGE_STAFF` | Admin manages college team membership and roles; staff receives the permitted operational access. |
| Platform staff | `PLATFORM_ADMIN`, `KYB_REVIEWER`, `INTEGRITY_REVIEWER`, `SUPPORT_AGENT` | Platform admin has the full defined console capability set. Other staff roles receive specific review/support capabilities. |

There are ten named application roles. `NO_ACTIVE_MEMBERSHIP` is an account state used for routing/onboarding, not another permission-granting role.

### Existing controls

- **Backend enforcement:** `current_user` verifies identity; `require_role(...)` protects routes. Cognito verification checks signature, issuer, token use and client/audience expectations.
- **Tenant isolation:** membership roles must match the tenant type. PostgreSQL row-level security and database guards provide additional isolation on protected tables. This does not mean every table uses the same policy.
- **Team administration:** employer owners and college admins can list/add members, change roles and remove access through team APIs. Guards prevent removing the last owner/admin. Platform administration also includes organisation membership management.
- **Console capability matrix:** `CONSOLE_ROLES` assigns review, disputes, account management, contact visibility, recordings, suspension, audits and other capabilities to permitted platform roles.
- **Web portal restrictions:** route access and admin sections are filtered by role. Backend permissions remain authoritative. Mobile requests are subject to the same backend checks.
- **Additional business gates:** subscription status, employer access windows and KYB verification are separate from roles. A valid login alone does not satisfy those gates.
- **Audit support:** privileged operations have audit infrastructure and protected audit access. This inspection is not an exhaustive proof that every sensitive operation is audited.

Examples: KYB review is available to platform admins/KYB reviewers; integrity review to platform admins/integrity reviewers; disputes to platform admins/support agents; suspensions and audit search to platform admins. Job/Education Taxonomy and Insights configuration are platform-admin-restricted in portal access rules.

Evidence: `backend/app/core/deps.py`, `backend/app/core/auth/cognito.py`, `backend/app/modules/identity/domain.py`, `backend/app/modules/admin/domain.py`, `backend/app/modules/employer/router.py`, `backend/app/modules/college/router.py`, `backend/alembic/versions/0001_baseline_schema.py`, `frontend/lib/auth/route-access.ts`.

### Limitations and recommended follow-up

1. Roles and capability mappings are predefined in code. A general-purpose admin UI to create arbitrary roles and edit a permission matrix was not found. Changing the policy currently requires development work.
2. The web section map and backend capability matrix are maintained separately. Review both whenever access rules change.
3. Verify production role assignments, MFA policy, revoked-membership behavior, database connection roles/RLS and enabled providers against the actual deployment before treating this as a production access audit.
4. Review potentially unused packages and consolidate overlapping mobile icon/font libraries if practical.
5. Establish a dependency/SBOM and licence audit including transitive packages, fonts and native components; pin reproducible backend versions. Versions alone in this report do not indicate vulnerability status.
6. Complete a real payment provider and malware scanning before relying on those capabilities operationally.

No application behavior, environment variables, database schema or AWS resources were changed for this report.


## Complete direct dependency manifest inventory

### frontend: dependencies (13)

| Package | Declared version |
| --- | --- |
| `@hookform/resolvers` | `^5.9.1` |
| `@reduxjs/toolkit` | `^2.12.0` |
| `@tanstack/react-query` | `^5.102.8` |
| `aws-amplify` | `^6.16.0` |
| `libphonenumber-js` | `^1.13.15` |
| `lucide-react` | `^1.43.0` |
| `next` | `16.3.4` |
| `qrcode` | `^1.5.4` |
| `react` | `19.2.8` |
| `react-dom` | `19.2.8` |
| `react-hook-form` | `^7.87.0` |
| `react-redux` | `^9.3.0` |
| `zod` | `^4.5.4` |

### frontend: devDependencies (9)

| Package | Declared version |
| --- | --- |
| `@tailwindcss/postcss` | `^4` |
| `@types/node` | `^20` |
| `@types/qrcode` | `^1.5.5` |
| `@types/react` | `^19` |
| `@types/react-dom` | `^19` |
| `eslint` | `^9` |
| `eslint-config-next` | `16.3.4` |
| `tailwindcss` | `^4` |
| `typescript` | `^5` |

### mobile-app: dependencies (47)

| Package | Declared version |
| --- | --- |
| `@expo-google-fonts/inter` | `^0.4.2` |
| `@expo-google-fonts/noto-sans-devanagari` | `^0.4.1` |
| `@expo-google-fonts/space-mono` | `^0.4.2` |
| `@expo/vector-icons` | `^15.0.3` |
| `@lucide/lab` | `^0.1.2` |
| `@react-native-async-storage/async-storage` | `2.2.0` |
| `@react-navigation/bottom-tabs` | `^7.2.0` |
| `@react-navigation/native` | `^7.0.14` |
| `@supabase/supabase-js` | `^2.58.0` |
| `babel-preset-expo` | `~54.0.10` |
| `expo` | `~54.0.37` |
| `expo-asset` | `~12.0.13` |
| `expo-audio` | `~1.1.1` |
| `expo-blur` | `~15.0.8` |
| `expo-camera` | `~17.0.10` |
| `expo-constants` | `~18.0.14` |
| `expo-document-picker` | `~14.0.8` |
| `expo-file-system` | `~19.0.24` |
| `expo-font` | `~14.0.12` |
| `expo-haptics` | `~15.0.8` |
| `expo-image-picker` | `~17.0.11` |
| `expo-linear-gradient` | `~15.0.8` |
| `expo-linking` | `~8.0.12` |
| `expo-notifications` | `^0.32.17` |
| `expo-router` | `~6.0.24` |
| `expo-sharing` | `~14.0.8` |
| `expo-speech` | `~14.0.8` |
| `expo-splash-screen` | `~31.0.13` |
| `expo-status-bar` | `~3.0.9` |
| `expo-symbols` | `~1.0.8` |
| `expo-system-ui` | `~6.0.9` |
| `expo-web-browser` | `~15.0.11` |
| `libphonenumber-js` | `^1.13.15` |
| `lucide-react-native` | `^0.544.0` |
| `phosphor-react-native` | `^3.0.6` |
| `react` | `19.1.0` |
| `react-dom` | `19.1.0` |
| `react-native` | `0.81.5` |
| `react-native-gesture-handler` | `~2.28.0` |
| `react-native-reanimated` | `~4.1.1` |
| `react-native-safe-area-context` | `~5.6.0` |
| `react-native-screens` | `~4.16.0` |
| `react-native-svg` | `15.12.1` |
| `react-native-url-polyfill` | `^2.0.0` |
| `react-native-web` | `^0.21.0` |
| `react-native-webview` | `13.15.0` |
| `react-native-worklets` | `0.5.1` |

### mobile-app: devDependencies (6)

| Package | Declared version |
| --- | --- |
| `@babel/core` | `^7.25.2` |
| `@expo/ngrok` | `^4.1.3` |
| `@types/react` | `~19.1.10` |
| `eslint` | `^9.0.0` |
| `eslint-config-expo` | `~10.0.0` |
| `typescript` | `~5.9.2` |

### Backend: runtime (22)

- `fastapi>=0.115`
- `uvicorn[standard]>=0.32`
- `pydantic>=2.9`
- `pydantic-settings>=2.6`
- `python-multipart>=0.0.12`
- `sqlalchemy[asyncio]>=2.0.36,<2.1`
- `asyncpg>=0.30`
- `alembic>=1.14`
- `redis>=5.2`
- `celery[sqs]>=5.4`
- `boto3>=1.35`
- `pypdf>=5.1`
- `pypdfium2>=4.30`
- `Pillow>=10.4`
- `python-docx>=1.1`
- `typst>=0.13.2,<0.14`
- `pyjwt[crypto]>=2.10`
- `httpx>=0.28`
- `structlog>=24.4`
- `opentelemetry-api>=1.28`
- `opentelemetry-sdk>=1.28`
- `opentelemetry-instrumentation-fastapi>=0.49b0`

### Backend: dev (12)

- `pytest>=8.3`
- `pytest-asyncio>=0.24`
- `pytest-cov>=6.0`
- `hypothesis>=6.115`
- `testcontainers[postgres]>=4.8`
- `schemathesis>=3.38`
- `polyfactory>=2.18`
- `ruff>=0.8`
- `mypy>=1.13`
- `import-linter>=2.1`
- `pre-commit>=4.0`
- `types-boto3`

### Backend: build (1)

- `setuptools>=75`
