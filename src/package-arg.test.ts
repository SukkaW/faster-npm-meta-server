import { expect } from 'earl';
import { describe, it } from 'mocha';
import realNpa from 'npm-package-arg';
import { parsePackageArg } from './package-arg';

describe('parsePackageArg npa parity', () => {
  it('parses registry specs', () => {
    expect(parsePackageArg('vite')).toHaveSubset({
      type: 'range',
      registry: true,
      name: 'vite',
      fetchSpec: '*',
      raw: 'vite'
    });
    expect(parsePackageArg('vite@2')).toHaveSubset({
      type: 'range',
      name: 'vite',
      fetchSpec: '2'
    });
    expect(parsePackageArg('vite@2.9.18')).toHaveSubset({
      type: 'version',
      fetchSpec: '2.9.18'
    });
    expect(parsePackageArg('vite@=7.0.3')).toHaveSubset({
      type: 'version',
      fetchSpec: '=7.0.3'
    });
    expect(parsePackageArg('vite@latest')).toHaveSubset({
      type: 'tag',
      fetchSpec: 'latest'
    });
    expect(parsePackageArg('vite@>=2.0.0 <3.0.0')).toHaveSubset({
      type: 'range',
      fetchSpec: '>=2.0.0 <3.0.0'
    });
    // trailing empty spec means any version
    expect(parsePackageArg('vite@')).toHaveSubset({
      type: 'range',
      fetchSpec: '*'
    });
  });

  it('parses scoped packages', () => {
    expect(parsePackageArg('@antfu/utils@^1.0.0')).toHaveSubset({
      type: 'range',
      name: '@antfu/utils',
      scope: '@antfu',
      escapedName: '@antfu%2futils',
      fetchSpec: '^1.0.0'
    });
    expect(parsePackageArg('@antfu/utils')).toHaveSubset({
      type: 'range',
      name: '@antfu/utils',
      fetchSpec: '*'
    });
  });

  it('keeps npa quirks for names that are only valid as legacy packages', () => {
    expect(parsePackageArg('name!!')).toHaveSubset({
      type: 'range',
      registry: true,
      name: 'name!!'
    });
  });

  it('throws the exact npa invalid tag error', () => {
    expect(() => parsePackageArg('postcss@8.4.31+react@18.2.0')).toThrow(
      'Invalid tag name "8.4.31+react@18.2.0" of package "postcss@8.4.31+react@18.2.0": Tags may not have any characters that encodeURIComponent encodes.'
    );
  });

  it('throws the exact npa invalid name error', () => {
    expect(() => parsePackageArg('.hidden@1.0.0')).toThrow(
      'Invalid package name ".hidden" of package ".hidden@1.0.0": name cannot start with a period.'
    );
    expect(() => parsePackageArg('in valid@1.0.0')).toThrow(
      'Invalid package name "in valid" of package "in valid@1.0.0": name can only contain URL-friendly characters.'
    );
  });

  it('leaves the name empty for bare range-like or tag-like specs', () => {
    expect(parsePackageArg('<3.0.0')).toHaveSubset({
      type: 'range',
      name: null
    });
    expect(parsePackageArg('-')).toHaveSubset({
      type: 'tag',
      name: null
    });
  });

  it('classifies non-registry specs so handlers can reject them', () => {
    expect(parsePackageArg('github:antfu/utils')).toHaveSubset({
      type: 'git',
      name: null,
      registry: false
    });
    expect(parsePackageArg('antfu/utils')).toHaveSubset({
      type: 'git',
      name: null
    });
    expect(parsePackageArg('git@github.com:antfu/utils.git')).toHaveSubset({
      type: 'git',
      name: null
    });
    expect(parsePackageArg('git+https://github.com/antfu/utils.git')).toHaveSubset({
      type: 'git'
    });
    expect(parsePackageArg('https://example.com/package.tgz')).toHaveSubset({
      type: 'remote',
      name: null
    });
    expect(parsePackageArg('./local/dir')).toHaveSubset({
      type: 'directory',
      name: null
    });
    expect(parsePackageArg('package.tgz')).toHaveSubset({
      type: 'file',
      name: null
    });
    expect(parsePackageArg('pkg@npm:vite@^5.0.0')).toHaveSubset({
      type: 'alias',
      registry: true,
      name: 'pkg'
    });
    expect(parsePackageArg('pkg@npm:vite@^5.0.0').subSpec!).toHaveSubset({
      type: 'range',
      name: 'vite',
      fetchSpec: '^5.0.0'
    });
  });

  it('rejects invalid aliases and URL types with npa messages', () => {
    expect(() => parsePackageArg('pkg@npm:npm:vite')).toThrow('nested aliases not supported');
    expect(() => parsePackageArg('pkg@npm:github:antfu/utils')).toThrow('aliases only work for registry deps');
    expect(() => parsePackageArg('pkg@npm:<3.0.0')).toThrow('aliases must have a name');
    expect(() => parsePackageArg('pkg@foo://bar')).toThrow('Unsupported URL Type "foo:": foo://bar');
  });

  // differential check against the real npm-package-arg (devDependency only —
  // the production bundle uses parsePackageArg to stay free of Node builtins)
  describe('differential against npm-package-arg', () => {
    const SPECS = [
      'vite', 'vite@2', 'vite@2.9.18', 'vite@=7.0.3', 'vite@v5.0.0', 'vite@latest', 'vite@',
      'vite@^5.0.0-beta.0', 'vite@>=2.0.0 <3.0.0', 'vite@5.0 - 5.4', 'vite@2.x',
      'vite@~3.6', 'vite@*', 'vite@next',
      '@antfu/utils', '@antfu/utils@^1.0.0', '@antfu/utils@latest', '@antfu/utils@1.0.0-beta.1+build',
      'name!!', 'under_score', 'dot.name', 'name-with-dash', '123numeric',
      '<3.0.0', '-', '=', '^', '1.2.3', '8.4.31+react@18.2.0',
      'postcss@8.4.31+react@18.2.0', '.hidden@1.0.0', '_private@1.0.0',
      'in valid@1.0.0', 'UPPERCASE@1.0.0', 'node_modules@1.0.0', 'favicon.ico',
      'pkg@npm:vite@^5.0.0', 'pkg@npm:npm:vite', 'pkg@npm:<3.0.0',
      'github:antfu/utils', 'antfu/utils', 'antfu/utils#main',
      'git@github.com:antfu/utils.git', 'git+https://github.com/antfu/utils.git',
      'git+ssh://git@github.com:antfu/utils.git#semver:^1.0.0',
      'https://example.com/package.tgz', 'pkg@foo://bar',
      'package.tgz', 'pkg@file:./foo', 'pkg@~/foo/bar',
      '@scope/pkg@npm:other@1 || 2'
    ];

    for (const spec of SPECS) {
      it(`matches npa for ${JSON.stringify(spec)}`, () => {
        let expected: ReturnType<typeof realNpa> | undefined;
        let expectedError: unknown;
        try {
          expected = realNpa(spec);
        } catch (error) {
          expectedError = error;
        }

        if (expectedError) {
          expect(() => parsePackageArg(spec)).toThrow((expectedError as Error).message);
          return;
        }

        const actual = parsePackageArg(spec);
        expect(actual.type).toEqual(expected!.type);
        expect(actual.name).toEqual(expected!.name ?? null);
        // npa's types claim `registry` is boolean, but at runtime it is
        // undefined for non-registry spec types
        expect(actual.registry).toEqual((expected as { registry?: boolean }).registry ?? false);
        if (expected!.registry) {
          expect(actual.fetchSpec).toEqual(expected!.fetchSpec);
          expect(actual.escapedName).toEqual(expected!.escapedName ?? null);
          expect(actual.scope).toEqual(expected!.scope ?? null);
        }
      });
    }
  });
});
