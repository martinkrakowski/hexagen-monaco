# Deployment Guide

This guide covers building the HexaGen Monaco monorepo Docker image and deploying it to a production VPS.

## Prerequisites

- Docker installed on the build machine
- Access to a Linux VPS with Docker installed
- SSH access to both the build machine and VPS
- `yarn` 4.x with corepack enabled

## Overview

The deployment process follows this flow:

```
Build Machine (with resources) → tar.gz archive → Production VPS → Docker Container
```

Due to the monorepo's size and dependency requirements, builds must be performed on a machine with adequate resources (recommended: 64GB+ RAM). The resulting image is then transferred to the production VPS.

## Build Process

### 1. Set Up the Build Environment

On your build machine (not the VPS), clone the repository and install dependencies:

```bash
git clone <repository-url>
cd hexagen-monaco
yarn install
```

### 2. Create `.yarnrc.yml` for Docker Builds

Create a `.yarnrc.yml` file in the project root to ensure Yarn uses the `node-modules` linker during Docker builds:

```yaml
nodeLinker: node-modules
```

> **Important:** This file is required for Docker builds because Yarn 4's default PnP (Plug'n'Play) mode stores packages in system cache paths that won't exist inside the container. The `node-modules` linker places packages in `./node_modules` where Next.js can find them.

### 3. Configure `.dockerignore`

Ensure the `.dockerignore` file in the project root excludes unnecessary files but allows the Yarn package directories:

```
node_modules
.next
.yarn/cache
.yarn/install-state.gz
.git
.gitignore
README.md
docs
k8s
*.md
*.log
```

> **Note:** Do NOT exclude `.yarn/unplugged` if you plan to use Yarn PnP mode. However, using `nodeLinker: node-modules` (recommended) means this is not needed.

### 4. Build the Docker Image

From the project root:

```bash
docker build -f apps/web/Dockerfile -t hexagen-monaco-web:prod .
```

Expected build time: 2-5 minutes depending on machine resources.

Verify the image size (should be 300-500MB with all dependencies):

```bash
docker images hexagen-monaco-web:prod
```

### 5. Export and Transfer

Save the image to a tarball and transfer to the VPS:

```bash
# Save locally
docker save hexagen-monaco-web:prod | gzip > hexagen-web.tar.gz

# Transfer to VPS (replace with your VPS hostname)
scp hexagen-web.tar.gz user@your-vps:/opt/hexagen-monaco/
```

## VPS Deployment

### 1. Load the Docker Image

SSH into your VPS and load the image:

```bash
ssh user@your-vps
cd /opt/hexagen-monaco
docker load < hexagen-web.tar.gz
```

### 2. Create docker-compose.yml

Create a `docker-compose.yml` in `/opt/hexagen-monaco/`:

```yaml
services:
  web:
    image: hexagen-monaco-web:prod
    container_name: hexagen-web
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - NODE_ENV=production
      - AUTH_SECRET=<generate-with-openssl-rand-base64-32>
```

### 3. Start the Container

```bash
docker compose up -d
```

### 4. Verify Deployment

Check the container logs:

```bash
docker compose logs --tail=50 web
```

You should see:

```
▲ Next.js 16.x.x
- Local: http://[container]:3000
✓ Ready in Xms
```

Test the endpoint:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
# Should return: 200
```

## Troubleshooting

### 500 errors on `/api/auth/session`

**Symptom:** API routes return 500 with `[next-auth][error][NO_SECRET]`

**Cause:** Missing `AUTH_SECRET` environment variable in production.

**Solution:**

1. Generate a secret: `openssl rand -base64 32`
2. Add to `docker-compose.yml`:
   ```yaml
   environment:
     - AUTH_SECRET=<your-secret>
   ```
3. Restart: `docker compose down && docker compose up -d`

### `MODULE_NOT_FOUND` error for `next`

**Symptom:** Container logs show `Error: Cannot find module 'next'`

**Cause:** The Docker image was built without properly bundled dependencies.

**Solution:**

1. Ensure `.yarnrc.yml` with `nodeLinker: node-modules` exists before running `yarn install` in the Dockerfile
2. Verify the `node_modules` directory is being copied into the container
3. Check that the image contains `next` in `/app/node_modules/`

### Out of Memory during build

**Symptom:** Build fails with `cannot allocate memory`

**Cause:** The build machine doesn't have enough RAM (minimum 16GB recommended, 64GB for full monorepo builds)

**Solution:** Use a build machine with more RAM, or build incrementally using Turborepo filters.

### Container starts but immediately crashes

**Symptom:** Container enters a restart loop

**Solution:**

1. Check logs: `docker compose logs web`
2. Verify port 3000 is not in use: `netstat -tlnp | grep 3000`
3. Ensure all required environment variables are set

## Environment Variables

The following environment variables are required or available for the container:

### Required for Production

| Variable      | Description                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET` | Secret for NextAuth JWT signing. **Required in production.** Generate with `openssl rand -base64 32` |

### Optional Authentication

If using GitHub OAuth login:

| Variable        | Description                    |
| --------------- | ------------------------------ |
| `GITHUB_ID`     | GitHub OAuth app client ID     |
| `GITHUB_SECRET` | GitHub OAuth app client secret |

### Optional Configuration

| Variable             | Default      | Description                               |
| -------------------- | ------------ | ----------------------------------------- |
| `NODE_ENV`           | `production` | Runtime environment                       |
| `PORT`               | `3000`       | Port the server listens on                |
| `HOSTNAME`           | `0.0.0.0`    | Host the server binds to                  |
| `KEEP_ALIVE_TIMEOUT` | (none)       | Server keep-alive timeout in milliseconds |

### Generating AUTH_SECRET

```bash
# Generate a secure secret
openssl rand -base64 32
```

Add the generated value to your `docker-compose.yml`:

```yaml
environment:
  - NODE_ENV=production
  - AUTH_SECRET=<paste-generated-secret-here>
```

> **Security Note:** Never commit secrets to git. Environment variables should be managed on the VPS directly in `docker-compose.yml` or via a secrets manager.

## Updating the Deployment

To deploy a new version:

1. Build the new image on your build machine
2. Transfer to VPS: `scp hexagen-web.tar.gz user@your-vps:/opt/hexagen-monaco/`
3. On VPS, reload:
   ```bash
   docker compose down
   docker rmi hexagen-monaco-web:prod
   docker load < hexagen-web.tar.gz
   docker compose up -d
   ```

## Architecture Notes

### Why Not Build Directly on VPS?

The monorepo requires significant resources to build (882 packages, Next.js compilation with TypeScript). A 512MB VPS cannot complete the build. The recommended approach is:

1. Build on a resourced machine (local dev server, CI runner)
2. Transfer the final image to production

### Yarn PnP vs node-modules

Yarn 4 defaults to PnP (Plug'n'Play) mode which:

- Stores packages in `.yarn/unplugged/` and `.yarn/berry/cache/`
- Uses absolute paths referencing the host filesystem
- Is incompatible with Docker containers that have isolated filesystems

The `nodeLinker: node-modules` setting forces Yarn to use traditional `node_modules/` directories, which Docker can properly capture and transfer.
