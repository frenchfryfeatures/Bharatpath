import type { RootState } from "@/store";

export const selectEmployerApplications = (
  state: RootState,
) => state.employerApplications.items;

export const selectApplicationJobFilter = (
  state: RootState,
) => state.employerApplications.selectedJobId;

export const selectOpenApplicationId = (
  state: RootState,
) => state.employerApplications.openApplicationId;

export const selectFilteredEmployerApplications = (
  state: RootState,
) => {
  const applications =
    state.employerApplications.items;

  const jobFilter =
    state.employerApplications.selectedJobId;

  if (jobFilter === "all") {
    return applications;
  }

  return applications.filter(
    (application) =>
      application.jobId === jobFilter,
  );
};

export const selectOpenApplication = (
  state: RootState,
) => {
  const id =
    state.employerApplications.openApplicationId;

  if (!id) {
    return null;
  }

  return (
    state.employerApplications.items.find(
      (application) =>
        application.id === id,
    ) ?? null
  );
};