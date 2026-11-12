FROM ghcr.io/voidzero-dev/vite-plus:1.6.0@sha256:eefe84f6bf32756307fe1452b49c81e6b3af98edb328a838ac1e90d6faaa7acc

# The base image supplies curl, build-essential and pkg-config, and runs as vp.
# Install Rust as that user, without adding debugger capabilities or disabling
# seccomp. Stable matches the previous feature's default; Rust is not repo-pinned.
ENV CARGO_HOME=/home/vp/.cargo \
    RUSTUP_HOME=/home/vp/.rustup
ENV PATH=/home/vp/.cargo/bin:${PATH}

ADD --chmod=0644 --checksum=sha256:9502b514362a21096210d498f143b8cdacda365d3dfcf45e8f5541e089ccafc0 https://sh.rustup.rs /tmp/rustup-init.sh
RUN sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal \
    --default-toolchain stable --component rust-analyzer,rust-src,rustfmt,clippy
