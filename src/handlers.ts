import type { QueryObject } from 'ufo';
import type { ParsedSpec } from './package-arg';
import {
  clean,
  isLess,
  isLessOrEqual,
  satisfies
} from 'verkit';
import { HttpError } from './errors';
import type {
  FetchPackageManifest,
  PackageManifest,
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
    let maxVersion: string | null = manifest.distTags.latest;
    if (!satisfies(maxVersion, fetchSpec)) {
      maxVersion = null;
    }

    const versions = Object.keys(manifest.versionsMeta);
    for (let index = 0; index < versions.length; index++) {
      const candidate = versions[index];
      if (
        satisfies(candidate, fetchSpec)
        && (!maxVersion || isLessOrEqual(candidate, maxVersion))
      ) {
        version = candidate;
      }
    }
  } else {
    // spec.type === 'version' — parsePackageArg only produces tag/range/version
    version = clean(fetchSpec, { loose: true });
    specifier = fetchSpec;

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
    const satisfiedVersions = versions.filter(
      version => satisfies(version, fetchSpec)
    );
    if (query.loose) {
      versions = versions.filter((version) => {
        if (satisfiedVersions.includes(version)) {
          return true;
        }
        return satisfiedVersions.some(satisfied => isLess(satisfied, version));
      });
    } else {
      versions = satisfiedVersions;
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
      versionsMeta: Object.fromEntries(
        versions.map(version => [version, manifest.versionsMeta[version]])
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
      ...Object.fromEntries(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mirror upstream runtime guard
        versions.map(version => [version, manifest.versionsMeta[version]?.time])
      ),
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
