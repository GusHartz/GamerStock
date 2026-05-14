import { AVATAR_CATALOG, AVATAR_IDS, DEFAULT_AVATAR_ID, getAvatarUrl } from "@shared/arena-config";

export interface AvatarItem {
  id: string;
  label: string;
  url: string;
}

export const AVATARS: AvatarItem[] = AVATAR_CATALOG.map((a) => ({
  id: a.id,
  label: a.label,
  url: getAvatarUrl(a.id),
}));

export { AVATAR_IDS, DEFAULT_AVATAR_ID, getAvatarUrl };
