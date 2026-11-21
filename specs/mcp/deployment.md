Status: draft

# `deployment`: what runs in the test namespace

`deployment` takes an optional `service` and returns `{services: [{service, image, pods, events}]}` for that service, or for every configured service sorted by name. `image` is the Deployment's container image with its tag; `pods` are `{name, phase, restarts, ageSeconds}` sorted by name; `events` are the Kubernetes events of the Deployment and its pods from the last hour, newest first, at most 50. The Kubernetes calls are fixed server-side and read only the test namespace; the workload of a service comes from the same configured map as `logs`.

The scenarios are queries against the `Cluster` fake: `ServiceContainer` is the configured map, `Deployment: { name, image }`, `Pod: { name, deployment, phase, restarts, startedAt }` and `KubeEvent: { object, reason, message, ts }` are cluster objects. Calls reach the tool already authenticated (`specs/mcp/transport.md`).

## Image, pods and recent events of one service

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - ServiceContainer: { service: api, container: pipeline-api-test-main }
  - Deployment: { name: pipeline-worker-test-main, image: "ghcr.io/eq-lab/pipeline-worker:sha-a94e175" }
  - Deployment: { name: pipeline-api-test-main, image: "ghcr.io/eq-lab/pipeline-api:sha-a94e175" }
  - Pod: { name: pipeline-worker-test-main-7f9c-x2k4p, deployment: pipeline-worker-test-main, phase: Running, restarts: 3, startedAt: 2026-11-21T11:00:00Z }
  - KubeEvent: { object: pipeline-worker-test-main-7f9c-x2k4p, reason: BackOff, message: "Back-off restarting failed container", ts: 2026-11-21T11:40:00Z }
  - KubeEvent: { object: pipeline-worker-test-main-7f9c-x2k4p, reason: Pulled, message: "Container image pulled", ts: 2026-11-21T11:00:00Z }
query:
  Deployment: { service: worker }
then:
  services:
    - service: worker
      image: "ghcr.io/eq-lab/pipeline-worker:sha-a94e175"
      pods:
        - { name: pipeline-worker-test-main-7f9c-x2k4p, phase: Running, restarts: 3, ageSeconds: 3600 }
      events:
        - { reason: BackOff, ts: 2026-11-21T11:40:00Z }
        - { reason: Pulled, ts: 2026-11-21T11:00:00Z }
```

## Without a service every configured service is listed

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - ServiceContainer: { service: api, container: pipeline-api-test-main }
  - Deployment: { name: pipeline-worker-test-main, image: "ghcr.io/eq-lab/pipeline-worker:sha-a94e175" }
  - Deployment: { name: pipeline-api-test-main, image: "ghcr.io/eq-lab/pipeline-api:sha-a94e175" }
query:
  Deployment: {}
then:
  services:
    - { service: api, image: "ghcr.io/eq-lab/pipeline-api:sha-a94e175", pods: [], events: [] }
    - { service: worker, image: "ghcr.io/eq-lab/pipeline-worker:sha-a94e175", pods: [], events: [] }
```

## Events older than an hour are left out

```spec
now: 2026-11-21T12:00:00Z
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - Deployment: { name: pipeline-worker-test-main, image: "ghcr.io/eq-lab/pipeline-worker:sha-a94e175" }
  - KubeEvent: { object: pipeline-worker-test-main, reason: ScalingReplicaSet, message: "Scaled up", ts: 2026-11-21T10:00:00Z }
query:
  Deployment: { service: worker }
then:
  services:
    - { service: worker, events: [] }
```

## An unknown service is rejected

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
query:
  Deployment: { service: kube-system }
then:
  rejected: unknown_service
```

## An unreachable Kubernetes API is reported, not hidden

```spec
given:
  - ServiceContainer: { service: worker, container: pipeline-worker-test-main }
  - SourceDown: { source: k8s, error: connection refused }
query:
  Deployment: { service: worker }
then:
  rejected: cluster_unavailable
```
