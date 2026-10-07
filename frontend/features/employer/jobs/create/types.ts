import type { JobDetails } from "@/features/jobs/job-details";
import type { JobWorkMode } from "../types";

/**
 * The composer's state. The `jobs` columns sit at the top in the units an
 * employer types (rupees, years); everything else is the API's `details`
 * document as-is, so nothing about it is translated twice.
 *
 * Bullet lists (`details.content.*`) hold the raw lines of their textareas,
 * blanks included, so a line can be typed after Enter. Blank lines are
 * dropped when the body is built.
 */
export interface CreateJobFormValues {
  title: string;
  workMode: JobWorkMode | "";
  location: string;
  description: string;
  skills: string[];
  experienceMin: number | "";
  experienceMax: number | "";
  salaryMin: number | "";
  salaryMax: number | "";
  minScore: number;
  details: JobDetails;
}
