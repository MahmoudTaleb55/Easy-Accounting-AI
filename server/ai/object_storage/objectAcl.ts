export type ObjectStorageFileLike = {
  name: string;
  exists(): Promise<boolean[]> | Promise<[boolean]>;
  getMetadata(): Promise<any[]>;
  setMetadata(payload: { metadata?: Record<string, string> }): Promise<void>;
};

const ACL_POLICY_METADATA_KEYS = [
  "custom:aclPolicy",
  "customaclpolicy",
  "custom_acl_policy",
  "x-amz-meta-custom-acl-policy",
] as const;

const ACL_POLICY_METADATA_KEY = "customaclpolicy";

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }

  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

function readAclPolicyFromMetadata(metadata?: Record<string, string>): string | null {
  if (!metadata) return null;
  for (const key of ACL_POLICY_METADATA_KEYS) {
    const value = metadata[key] ?? metadata[key.toLowerCase()];
    if (value) return value;
  }
  return null;
}

function writeAclPolicyToMetadata(
  metadata: Record<string, string> | undefined,
  aclPolicy: ObjectAclPolicy,
): Record<string, string> {
  const nextMetadata = { ...(metadata ?? {}) };
  for (const key of ACL_POLICY_METADATA_KEYS) {
    delete nextMetadata[key];
    delete nextMetadata[key.toLowerCase()];
  }
  nextMetadata[ACL_POLICY_METADATA_KEY] = JSON.stringify(aclPolicy);
  return nextMetadata;
}

export async function setObjectAclPolicy(
  objectFile: ObjectStorageFileLike,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  const [metadata] = await objectFile.getMetadata();
  await objectFile.setMetadata({
    metadata: writeAclPolicyToMetadata(metadata?.metadata ?? {}, aclPolicy),
  });
}

export async function getObjectAclPolicy(
  objectFile: ObjectStorageFileLike,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = readAclPolicyFromMetadata(metadata?.metadata ?? {});
  if (!aclPolicy) {
    return null;
  }
  return JSON.parse(aclPolicy as string);
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: ObjectStorageFileLike;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}

