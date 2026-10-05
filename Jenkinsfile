pipeline {
    agent any

    // Serialize deploys so two runs never push the Pages branch concurrently.
    options {
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        // launchd-started Jenkins gets a minimal PATH; include the usual macOS install locations for node/npm.
        PATH         = "/usr/local/bin:/opt/homebrew/bin:${PATH}"
        APP_NAME     = 'smartrpd'
        GH_REPO      = 'NDCS-SmartRPD/tmp.rpd'                      // owner/repo
        PAGES_BRANCH = 'nyunt/dev-W7.1'                              // GitHub Pages publishing source (the test site)
        SITE_URL     = 'https://ndcs-smartrpd.github.io/tmp.rpd/'
        PAGES_DIR    = "${WORKSPACE}/.gh-pages"
        GH_CREDENTIALS = 'github-pages-token'                        // Jenkins username/PAT credential id
    }

    stages {
        stage('Capture Revision') {
            steps {
                script {
                    // Bind every later action to the exact commit SHA.
                    env.REVISION   = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
                    env.SHORT_REV  = env.REVISION.take(12)
                    env.RELEASE_ID = "${env.REVISION}-${env.BUILD_NUMBER}"
                }
                sh '''
                echo "📌 Revision: ${REVISION}"
                echo "📌 Build:    ${BUILD_NUMBER}"
                echo "📌 Site:     ${SITE_URL}"
                '''
            }
        }

        stage('Install') {
            steps {
                sh '''
                echo "📦 Deterministic install from lockfile..."
                if [ -f package-lock.json ]; then
                    npm ci
                else
                    echo "⚠️ package-lock.json missing — falling back to npm install"
                    npm install
                fi
                chmod +x node_modules/.bin/webpack || true
                '''
            }
        }

        stage('Test') {
            steps {
                // Fail-closed: any non-zero exit stops the pipeline before build/deploy.
                sh '''
                echo "🧪 Running configured non-interactive tests (Jest CI)..."
                npm run test:ci
                '''
            }
            post {
                always {
                    archiveArtifacts artifacts: 'coverage/**', allowEmptyArchive: true, fingerprint: true
                }
            }
        }

        stage('Build') {
            // Reached only after an explicit test pass.
            steps {
                sh '''
                echo "🛠️ Production Webpack build..."
                npm run build
                test -f dist/bundle.js || { echo "❌ build produced no dist/bundle.js"; exit 1; }
                ls -lh dist/
                '''
            }
        }

        stage('Manifest') {
            steps {
                // Revision-keyed evidence served alongside the site.
                sh '''
                CREATED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
                # -z/-0 keeps filenames with spaces (e.g. assets/instruction editor/) intact.
                DIGEST=$({ git ls-files -z; printf 'dist/bundle.js\\0'; } | LC_ALL=C sort -zu | xargs -0 sha256sum | sha256sum | cut -d" " -f1)

                cat > manifest.json <<EOF
{
  "app": "${APP_NAME}",
  "revision": "${REVISION}",
  "buildId": "${BUILD_NUMBER}",
  "releaseId": "${RELEASE_ID}",
  "digest": "sha256:${DIGEST}",
  "createdAt": "${CREATED}",
  "siteUrl": "${SITE_URL}"
}
EOF
                echo "🔒 Artifact digest: sha256:${DIGEST}"
                cat manifest.json
                '''
                archiveArtifacts artifacts: 'manifest.json', fingerprint: true
            }
        }

        stage('Deploy Test Site') {
            steps {
                // Replace the Pages branch content with exactly this verified revision
                // plus the freshly built bundle and manifest. History is preserved —
                // every previous deploy remains one commit back for instant rollback.
                withCredentials([usernamePassword(
                    credentialsId: env.GH_CREDENTIALS,
                    usernameVariable: 'GH_USER',
                    passwordVariable: 'GH_TOKEN')]) {
                    sh '''
                    set -e
                    REMOTE="https://${GH_USER}:${GH_TOKEN}@github.com/${GH_REPO}.git"

                    echo "🌿 Fetching ${PAGES_BRANCH}..."
                    rm -rf "${PAGES_DIR}"
                    git clone --branch "${PAGES_BRANCH}" --single-branch --depth 1 "${REMOTE}" "${PAGES_DIR}"

                    echo "🚚 Mirroring verified revision ${SHORT_REV} into Pages branch..."
                    find "${PAGES_DIR}" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
                    git archive "${REVISION}" | tar -x -C "${PAGES_DIR}"

                    mkdir -p "${PAGES_DIR}/dist"
                    cp dist/bundle.js "${PAGES_DIR}/dist/"
                    cp manifest.json  "${PAGES_DIR}/"
                    touch "${PAGES_DIR}/.nojekyll"

                    cd "${PAGES_DIR}"
                    test -f index.html || { echo "❌ deploy missing index.html"; exit 1; }
                    git add -A
                    if git diff --cached --quiet; then
                        echo "ℹ️ Site already at ${REVISION} — nothing to push"
                    else
                        git -c user.email='ci@smartrpd.local' -c user.name='SmartRPD CI' \
                            commit -m "Deploy ${REVISION} (build ${BUILD_NUMBER})"
                        git push "${REMOTE}" "${PAGES_BRANCH}"
                        echo "✅ Deployed to ${SITE_URL}"
                    fi
                    '''
                }
            }
        }
    }

    post {
        success {
            echo '✅ Test-site deployment complete.'
            echo "🔗 ${SITE_URL}"
            echo "🔗 ${SITE_URL}src/pages/case_list.html"
            echo "🔗 ${SITE_URL}src/pages/ThreeDViewer.html"
            echo "🧾 Evidence: ${SITE_URL}manifest.json"
        }
        failure {
            // A failed run never pushes, so the currently served site stays live.
            echo '❌ Pipeline failed — nothing pushed; the served site is unchanged.'
        }
        always {
            sh 'rm -rf "${PAGES_DIR}" || true'
        }
    }
}
