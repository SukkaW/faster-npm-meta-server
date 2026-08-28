import type { QueryObject } from 'ufo';
import type { SemVer } from 'verkit';
import type { ParsedSpec } from './package-arg';
import {
  clean,
  isLess,
  isLessOrEqual,
  satisfies,
  tryParse,
  tryParseRange
} from 'verkit';
import { HttpError } from './errors';
import type {
  FetchPackageManifest,
  PackageManifest,
  PackageVersionMeta,
  PackageVersionsInfo,
  PackageVersionsInfoWithMetadata,
  ResolvedPackageVersion,
  ResolvedPackageVersionWithMetadata
} from './types';

export async function resolvePackageVersion(
  spec: ParsedSpec,
  query: QueryObject,
  fetchManifest: FetchPackageManifest
): Promise<ResolvedPackageVersion | ResolvedPackageVersionWithMetadata> {
  const manifest = await fetchManifest(spec.name!, Boolean(query.force));
  const fetchSpec = spec.fetchSpec;

  let version: string | null = null;
  let specifier: string;

  if (spec.type === 'tag') {
    specifier = fetchSpec;
    version = manifest.distTags[fetchSpec];
  } else if (
    spec.type === 'range'
    && (fetchSpec === '*' || fetchSpec === 'latest')
  ) {
    version = manifest.distTags.latest;
    specifier = 'latest';
  } else if (spec.type === 'range') {
    specifier = fetchSpec;
    const range = tryParseRange(fetchSpec);
    const latest = tryParse(manifest.distTags.latest);
    const maxVersion = range && latest && satisfies(latest, range)
      ? latest
      : null;

    const versions = Object.keys(manifest.versionsMeta);
    for (let index = 0, len = versions.length; index < len; index++) {
      const candidate = versions[index];
      const parsedCandidate = tryParse(candidate);
      if (
        range
        && parsedCandidate
        && satisfies(parsedCandidate, range)
        && (!maxVersion || isLessOrEqual(parsedCandidate, maxVersion))
      ) {
        version = candidate;
      }
    }
  } else {
    // spec.type === 'version' — parsePackageArg only produces tag/range/version
    version = clean(fetchSpec, { loose: true });
    specifier = fetchSpec;

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime lookup can miss an exact version
    if (version && !manifest.versionsMeta[version]) {
      throw new HttpError(
        `Version ${version} of package ${spec.name} not found`,
        { status: 404 }
      );
    }
  }

  const metadata = version
    ? manifest.versionsMeta[version]
    : undefined;
  const result: ResolvedPackageVersion = {
    name: spec.name!,
    specifier,
    version,
    publishedAt: metadata?.time as string | null,
    lastSynced: manifest.lastSynced
  };

  if (query.metadata) {
    Object.assign(result, metadata);
  }

  return result;
}

export async function getPackageVersions(
  spec: ParsedSpec,
  query: QueryObject,
  fetchManifest: FetchPackageManifest
): Promise<PackageVersionsInfo | PackageVersionsInfoWithMetadata> {
  const manifest = await fetchManifest(spec.name!, Boolean(query.force));
  const fetchSpec = spec.fetchSpec;
  let versions = Object.keys(manifest.versionsMeta);

  if (fetchSpec !== '*' && spec.type === 'range') {
    const range = tryParseRange(fetchSpec);
    if (!range) {
      versions = [];
    } else if (query.loose) {
      const parsedVersions: Array<SemVer | null> = [];
      const satisfiedVersions: boolean[] = [];
      let minimumSatisfied: SemVer | null = null;

      for (let index = 0, len = versions.length; index < len; index++) {
        const parsedVersion = tryParse(versions[index]);
        parsedVersions.push(parsedVersion);

        const satisfied = Boolean(
          parsedVersion && satisfies(parsedVersion, range)
        );
        satisfiedVersions.push(satisfied);

        if (
          satisfied
          && parsedVersion
          && (!minimumSatisfied || isLess(parsedVersion, minimumSatisfied))
        ) {
          minimumSatisfied = parsedVersion;
        }
      }

      if (minimumSatisfied) {
        versions = versions.filter((version, index) => (
          satisfiedVersions[index]
          || isLess(minimumSatisfied, parsedVersions[index] ?? version)
        ));
      } else {
        versions = [];
      }
    } else {
      versions = versions.filter(version => satisfies(version, range));
    }
  } else if (spec.type === 'tag') {
    const tag = manifest.distTags[fetchSpec];
    if (tag) {
      versions = [tag];
    }
  }

  if (query.after) {
    const afterDate = normalizeQueryDate(query.after);
    if (afterDate) {
      versions = versions.filter((version) => {
        const metadata = manifest.versionsMeta[version];
        return Boolean(metadata.time && new Date(metadata.time) > afterDate);
      });
    }
  }

  if (query.metadata) {
    return {
      name: spec.name!,
      specifier: fetchSpec,
      distTags: manifest.distTags,
      lastSynced: manifest.lastSynced,
      timeCreated: manifest.timeCreated,
      timeModified: manifest.timeModified,
      versionsMeta: versions.reduce<Record<string, PackageVersionMeta>>(
        (accumulator, version) => {
          accumulator[version] = manifest.versionsMeta[version];
          return accumulator;
        },
        {}
      )
    };
  }

  return {
    name: spec.name!,
    specifier: fetchSpec,
    distTags: manifest.distTags,
    lastSynced: manifest.lastSynced,
    versions,
    time: {
      ...versions.reduce<Record<string, string>>((accumulator, version) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mirror upstream runtime guard
        const publishedAt = manifest.versionsMeta[version]?.time;
        // upstream emits `undefined` here, which JSON.stringify drops anyway
        if (publishedAt !== undefined) {
          accumulator[version] = publishedAt;
        }
        return accumulator;
      }, {}),
      created: manifest.timeCreated,
      modified: manifest.timeModified
    }
  };
}

export function getFullPackageManifest(
  spec: ParsedSpec,
  query: QueryObject,
  fetchManifest: FetchPackageManifest
): Promise<PackageManifest> {
  return fetchManifest(spec.name!, Boolean(query.force));
}

function normalizeQueryDate(input: unknown): Date | undefined {
  let raw: string | number | undefined;

  if (Array.isArray(input)) {
    raw = input[0];
  } else if (typeof input === 'string' || typeof input === 'number') {
    raw = input;
  }

  if (raw !== undefined && raw !== '') {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return undefined;
}
