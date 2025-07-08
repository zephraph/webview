# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is @justbe/webview, a cross-platform library for building web-based desktop apps. The architecture consists of:

- **Rust backend**: Core webview functionality using `tao` and `wry`
- **Multi-language clients**: Deno/TypeScript, Python, and Go clients that interface with the Rust binary via stdio

## Essential Commands

### Build Commands
```bash
# Build everything
mise build

# Build specific targets
mise build:rust    # Build the webview binary
mise build:deno    # Build Deno client
mise build:python  # Build Python client
mise build:go      # Build Go client
```

### Code Generation
```bash
# Generate all schemas and clients
mise gen

# Generate specific parts
mise gen:rust    # Generate JSON schemas from Rust
mise gen:deno    # Generate TypeScript client
mise gen:python  # Generate Python client
mise gen:go      # Generate Go client
```

### Linting and Type Checking
```bash
# Run all lints
mise lint

# Specific lints
mise lint:rust     # cargo fmt --check && cargo clippy
mise lint:deno     # deno lint && deno check
mise lint:go       # golangci-lint run
mise lint:ast-grep # AST-based linting
```

### Running Examples
```bash
# Run Deno example
mise run example:deno basic

# Run Python example  
mise run example:python basic

# Run Go example (binaries built in src/clients/go/build/)
mise run example:go simple
```

### Version Management
```bash
# Sync version numbers across all packages
mise sync-versions
```

## Architecture

### IPC Communication
- Client libraries communicate with the Rust binary via stdio (standard input/output)
- Messages are JSON-encoded and follow schemas defined in `schemas/`
- Schema-driven development ensures type safety across language boundaries

### Directory Structure
- `src/` - Rust source code
- `src/clients/deno/` - Deno/TypeScript client
- `src/clients/python/` - Python client
- `src/clients/go/` - Go client
- `schemas/` - JSON schemas for IPC messages
- `scripts/` - Build and generation scripts
- `sg/` - AST-grep linting rules

### Key Files
- `mise.toml` - Task runner configuration and tool versions
- `Cargo.toml` - Rust dependencies and build settings
- `src/clients/deno/deno.json` - Deno project configuration
- `src/clients/python/pyproject.toml` - Python project configuration
- `src/clients/go/go.mod` - Go module configuration

### Development Workflow
1. Rust structs define the message protocol
2. `mise gen:rust` generates JSON schemas from Rust code
3. `mise gen:deno`, `mise gen:python`, and `mise gen:go` generate typed clients from schemas
4. Clients automatically download platform binaries if needed
5. Communication happens via JSON messages over stdio