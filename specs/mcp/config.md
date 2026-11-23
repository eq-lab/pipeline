Status: approved

# `config`: runtime configuration with secrets masked

`config` returns `{services: [{service, env, secrets?, envFrom?}]}` for every configured service, sorted by name: `env` maps each environment variable of the service's Deployment to its value, with values from ConfigMaps resolved. A value is masked as `***` when it comes from a `secretKeyRef`, when its key contains `KEY`, `SECRET`, `TOKEN` or `PASSWORD` (any case), or when it is a URL with credentials (any user info, a user name alone included, since RPC providers put API keys there). Kubernetes Secrets are never read: a `secretKeyRef` is masked by its reference, not by its value. For each masked `secretKeyRef` variable, `secrets` maps the variable name to its reference `{secret, key}`, so an agent sees where the value comes from. `envFrom` lists the Deployment's `envFrom` sources in order as `{secret: <name>}` or `{configMap: <name>}`: names only, their keys and values are not read. `secrets` and `envFrom` are left out when empty.

The scenarios are queries against the `Cluster` fake: `ServiceContainer` is the configured map, `DeploymentEnv: { deployment, name, value }`, `{ deployment, name, configMapKeyRef: { name, key } }` or `{ deployment, name, secretKeyRef: { name, key } }` is one variable, `ConfigMapValue: { name, key, value }` a ConfigMap entry, `DeploymentEnvFrom: { deployment, secretRef: { name } }` or `{ deployment, configMapRef: { name } }` is one `envFrom` source, `SecretValue: { name, key, value }` a Secret the server must never read. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Plain and ConfigMap values are shown

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: RUST_LOG, value: info }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: EVM_RPC_URL, configMapKeyRef: { name: pipeline-config, key: evm_rpc_url } }
  - ConfigMapValue: { name: pipeline-config, key: evm_rpc_url, value: "https://rpc.sepolia.example.org" }
query:
  Config: {}
then:
  services:
    - service: worker
      env: { RUST_LOG: info, EVM_RPC_URL: "https://rpc.sepolia.example.org" }
```

## A value from a Secret is masked

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: BITGO_ACCESS, secretKeyRef: { name: pipeline-secrets, key: bitgo } }
  - SecretValue: { name: pipeline-secrets, key: bitgo, value: "v2x-real-secret" }
query:
  Config: {}
then:
  services:
    - service: worker
      env: { BITGO_ACCESS: "***" }
      secrets: { BITGO_ACCESS: { secret: pipeline-secrets, key: bitgo } }
```

## Secret-like keys are masked even with a plain value

```spec
given:
  - ServiceContainer: { service: api, container: pipeline-api-test-main }
  - DeploymentEnv: { deployment: pipeline-api-test-main, name: SUMSUB_API_KEY, value: "sk-123" }
  - DeploymentEnv: { deployment: pipeline-api-test-main, name: jwt_secret, value: "hs256-abc" }
  - DeploymentEnv: { deployment: pipeline-api-test-main, name: GRAFANA_TOKEN, value: "glsa_abc" }
  - DeploymentEnv: { deployment: pipeline-api-test-main, name: SMTP_PASSWORD, value: "hunter2" }
  - DeploymentEnv: { deployment: pipeline-api-test-main, name: PORT, value: "8080" }
query:
  Config: {}
then:
  services:
    - service: api
      env: { SUMSUB_API_KEY: "***", jwt_secret: "***", GRAFANA_TOKEN: "***", SMTP_PASSWORD: "***", PORT: "8080" }
```

## A secret-like key from a ConfigMap is masked

```spec
given:
  - ServiceContainer: { service: api, container: pipeline-api-test-main }
  - DeploymentEnv: { deployment: pipeline-api-test-main, name: WEBHOOK_SECRET, configMapKeyRef: { name: pipeline-config, key: webhook } }
  - ConfigMapValue: { name: pipeline-config, key: webhook, value: "whsec_abc" }
query:
  Config: {}
then:
  services:
    - service: api
      env: { WEBHOOK_SECRET: "***" }
```

## A URL with credentials is masked, a URL without is shown

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: DATABASE_URL, value: "postgres://pipeline:pw@db:5432/pipeline" }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: STELLAR_RPC, value: "https://user@soroban.example.org" }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: LOKI_URL, value: "http://loki:3100" }
query:
  Config: {}
then:
  services:
    - service: worker
      env: { DATABASE_URL: "***", STELLAR_RPC: "***", LOKI_URL: "http://loki:3100" }
```

## `envFrom` sources are listed by name, never read

```spec
given:
  - ServiceContainer: { service: api, container: pipeline-api-test-main }
  - DeploymentEnv: { deployment: pipeline-api-test-main, name: PORT, value: "8080" }
  - DeploymentEnvFrom: { deployment: pipeline-api-test-main, configMapRef: { name: pipeline-chains } }
  - DeploymentEnvFrom: { deployment: pipeline-api-test-main, secretRef: { name: pipeline-api-secrets } }
  - ConfigMapValue: { name: pipeline-chains, key: CHAINS, value: "1,11155111" }
  - SecretValue: { name: pipeline-api-secrets, key: SUMSUB_API_KEY, value: "sk-real" }
query:
  Config: {}
then:
  services:
    - service: api
      env: { PORT: "8080" }
      envFrom:
        - configMap: pipeline-chains
        - secret: pipeline-api-secrets
```

## Secret references and `envFrom` of two services

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - ServiceContainer: { service: api, container: pipeline-api-test-main }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: DATABASE_URL, secretKeyRef: { name: pipeline-db, key: url } }
  - DeploymentEnv: { deployment: pipeline-worker-test-main, name: RUST_LOG, value: info }
  - DeploymentEnvFrom: { deployment: pipeline-api-test-main, secretRef: { name: pipeline-api-secrets } }
  - SecretValue: { name: pipeline-db, key: url, value: "postgres://pipeline:pw@db:5432/pipeline" }
  - SecretValue: { name: pipeline-api-secrets, key: JWT_SECRET, value: "hs256-real" }
query:
  Config: {}
then:
  services:
    - service: api
      env: {}
      envFrom:
        - secret: pipeline-api-secrets
    - service: worker
      env: { DATABASE_URL: "***", RUST_LOG: info }
      secrets: { DATABASE_URL: { secret: pipeline-db, key: url } }
```

## An unreachable Kubernetes API is reported, not hidden

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - SourceDown: { source: k8s, error: connection refused }
query:
  Config: {}
then:
  rejected: cluster_unavailable
```
