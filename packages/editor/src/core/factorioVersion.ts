// this is how it works in factorio but js doesn't support 64bit bitwise operations
//  uint64_t(developerVersion) |
// (uint64_t(minorVersion) << 16) |
// (uint64_t(majorVersion) << 32) |
// (uint64_t(mainVersion) << 48)
//
// Lives on its own rather than in Blueprint.ts so nameMigrations.ts can compare
// versions without pulling FD - and the whole entity model behind it - into a
// unit test.
const getFactorioVersion = (main = 2, major = 0, minor = 45): number =>
    (minor << 16) + (major | (main << 16)) * 0xffffffff

export { getFactorioVersion }
