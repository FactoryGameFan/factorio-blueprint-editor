FROM ghcr.io/voidzero-dev/vite-plus:0.3.3@sha256:c25901a17884c55d71e34c1783fa8a77a5eb7e8834735868da775588cd30a1b4

# The base image supplies curl, build-essential and pkg-config, and runs as vp.
# Install Rust as that user, without adding debugger capabilities or disabling
# seccomp. Stable matches the previous feature's default; Rust is not repo-pinned.
ENV CARGO_HOME=/home/vp/.cargo \
    RUSTUP_HOME=/home/vp/.rustup
ENV PATH=/home/vp/.cargo/bin:${PATH}

ADD --chmod=0644 --checksum=sha256:7d0ea0f8eba7fa1ebfe998091cd7ec4501e33ec5ca6b884eb4d894d7da5170af https://sh.rustup.rs /tmp/rustup-init.sh
RUN sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal \
    --default-toolchain stable --component rust-analyzer,rust-src,rustfmt,clippy
