export interface ProjectListItem {
  ownerUserId: string;
}

export function groupProjects<T extends ProjectListItem>(projects: T[], currentUserId?: string) {
  return {
    owned: projects.filter((project) => project.ownerUserId === currentUserId),
    shared: projects.filter((project) => project.ownerUserId !== currentUserId),
  };
}
