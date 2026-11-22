FROM ghcr.io/voidzero-dev/vite-plus:1.4.0@sha256:5dfa2031f7d014b6376407fd99e0747bed329d792c79c184a65ec9a0765bee0e

# The base image supplies curl, build-essential and pkg-config, and runs as vp.
# Install Rust as that user, without adding debugger capabilities or disabling
# seccomp. Stable matches the previous feature's default; Rust is not repo-pinned.
ENV CARGO_HOME=/home/vp/.cargo \
    RUSTUP_HOME=/home/vp/.rustup
ENV PATH=/home/vp/.cargo/bin:${PATH}

# sh.rustup.rs serves rustup-init.sh from rustup's stable release. This digest
# is the 1.29.3 script; its only change from 1.29.2 is the version line in the
# help text.
ADD --chmod=0644 --checksum=sha256:d890e2fef6fa991b19cde2e608199bc1dca4e37f41f884edf8849ff693048de6 https://sh.rustup.rs /tmp/rustup-init.sh
RUN sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal \
    --default-toolchain stable --component rust-analyzer,rust-src,rustfmt,clippy
