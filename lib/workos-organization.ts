export function getRequiredWorkosOrganizationId() {
  const organizationId = process.env.WORKOS_ORGANIZATION_ID?.trim();

  return organizationId ? organizationId : undefined;
}

export function isAllowedWorkosOrganization(
  organizationId?: string | null,
) {
  const requiredOrganizationId = getRequiredWorkosOrganizationId();

  if (!requiredOrganizationId) {
    return true;
  }

  return organizationId === requiredOrganizationId;
}
