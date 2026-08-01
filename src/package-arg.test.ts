import { expect } from 'earl';
import { describe, it } from 'mocha';
import realNpa from 'npm-package-arg';
import { parsePackageArg } from './package-arg';

describe('parsePackageArg', () => {
  it('parses registry specs', () => {
    expect(parsePackageArg('foxts')).toHaveSubset({
      type: 'range',
      name: 'foxts',
      fetchSpec: '*',
      raw: 'foxts'
    });
    expect(parsePackageArg('foxts@5')).toHaveSubset({
      type: 'range',
      name: 'foxts',
      fetchSpec: '5'
    });
    expect(parsePackageArg('foxts@5.8.1')).toHaveSubset({
      type: 'version',
      fetchSpec: '5.8.1'
    });
    expect(parsePackageArg('foxts@=5.8.1')).toHaveSubset({
      type: 'version',
      fetchSpec: '=5.8.1'
    });
    expect(parsePackageArg('foxts@latest')).toHaveSubset({
      type: 'tag',
      fetchSpec: 'latest'
    });
    expect(parsePackageArg('foxts@>=5.0.0 <6.0.0')).toHaveSubset({
      type: 'range',
      fetchSpec: '>=5.0.0 <6.0.0'
    });
    // trailing empty spec means any version
    expect(parsePackageArg('foxts@')).toHaveSubset({
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

  it('rejects non-registry specs outright', () => {
    expect(() => parsePackageArg('github:antfu/utils')).toThrow('Unsupported url package spec "github:antfu/utils".');
    expect(() => parsePackageArg('git+https://github.com/antfu/utils.git')).toThrow('Unsupported url package spec');
    expect(() => parsePackageArg('git@github.com:antfu/utils.git')).toThrow('Unsupported git package spec');
    expect(() => parsePackageArg('./local/dir')).toThrow('Unsupported local path package spec');
    expect(() => parsePackageArg('~/foo/bar')).toThrow('Unsupported local path package spec');
    expect(() => parsePackageArg('antfu/utils')).toThrow('Unsupported local path package spec');
    expect(() => parsePackageArg('file:./foo')).toThrow('Unsupported file package spec');
    expect(() => parsePackageArg('npm:foxts@5')).toThrow('Unsupported npm alias package spec');
    // ...including when they hide in the version part
    expect(() => parsePackageArg('pkg@npm:foxts@5')).toThrow('Unsupported npm alias package spec "npm:foxts@5".');
    expect(() => parsePackageArg('pkg@file:./foo')).toThrow('Unsupported file package spec');
    expect(() => parsePackageArg('pkg@https://example.com/x.tgz')).toThrow('Unsupported url package spec');
    expect(() => parsePackageArg('pkg@~/foo/bar')).toThrow('Unsupported local path package spec');
  });

  it('rejects empty and malformed scoped specs', () => {
    expect(() => parsePackageArg('   ')).toThrow('Package spec must be a non-empty string.');
    expect(() => parsePackageArg('@scope')).toThrow('Invalid scoped package spec "@scope".');
    expect(() => parsePackageArg('@scope/')).toThrow('Invalid scoped package spec "@scope/".');
  });

  // differential check against the real npm-package-arg (devDependency only —
  // the production bundle uses parsePackageArg to stay free of Node builtins).
  // Only registry specs are compared: non-registry specs are intentionally
  // rejected with our own errors instead of npa's type classification.
  describe('differential against npm-package-arg (registry specs)', () => {
    const SPECS = [
      'foxts', 'foxts@5', 'foxts@5.8.1', 'foxts@=5.8.1', 'foxts@v5.8.1', 'foxts@latest', 'foxts@',
      'foxts@^5.0.0-beta.0', 'foxts@>=5.0.0 <6.0.0', 'foxts@5.0 - 5.4', 'foxts@5.x',
      'foxts@~5.8', 'foxts@*', 'foxts@next', 'foxts@1 || 2',
      '@antfu/utils', '@antfu/utils@^1.0.0', '@antfu/utils@latest',
      'name!!', 'under_score', 'dot.name', 'name-with-dash', '123numeric',
      '<3.0.0', '-', '=', '1.2.3', 'favicon.ico',
      'postcss@8.4.31+react@18.2.0', '8.4.31+react@18.2.0',
      '.hidden@1.0.0', '_private@1.0.0', 'in valid@1.0.0',
      'UPPERCASE@1.0.0', 'node_modules@1.0.0'
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
        expect<string>(actual.type).toEqual(expected!.type);
        expect(actual.name).toEqual(expected!.name ?? null);
        expect<string | null>(actual.fetchSpec).toEqual(expected!.fetchSpec);
        expect(actual.escapedName).toEqual(expected!.escapedName ?? null);
        expect(actual.scope).toEqual(expected!.scope ?? null);
      });
    }
  });
});
