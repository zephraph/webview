# CONTRIBUTING

This project is open for contributions. It requires that you have rust installed (see [`rust-toolchain.toml`](./rust-toolchain.toml)) for which version to install.

If you add a feature to the deno code you should also edit the version in the [`deno.json`](./deno.json) file. Likewise, if you make a change to the rust code you should update the version in the [`cargo.toml`](./Cargo.toml) file. Be sure to also add an entry to the [`CHANGELOG.md`](./CHANGELOG.md) file.

The easiest way to develop is to create a new example file for the feature you're working on. You can then use `deno task example <your-example>` to invoke that example. Doing so will run the build and re-generate any artifacts that need to be updated.

## Architecture

TKTK
