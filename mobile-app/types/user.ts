export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  city?: string;
  state?: string;
  preferredLanguage: string;
  education: EducationEntry[];
  skills: SkillEntry[];
  experience: ExperienceEntry[];
  readinessScore: number;
  readinessBand: number; // 1 to 4
  photoUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EducationEntry {
  id: string;
  degree: string;
  institution: string;
  yearRange: string;
  grade?: string;
}

export interface SkillEntry {
  id: string;
  name: string;
  category?: string;
  isUnclear?: boolean;
  suggestions?: string[];
}

export interface ExperienceEntry {
  id: string;
  title: string;
  company: string;
  location?: string;
  duration?: string;
  description?: string;
}

export interface ResumeMetadata {
  fileName: string;
  fileSize: string;
  uploadedAt: string;
  fileUrl?: string;
}

export interface CareerScoreData {
  current: number;
  max: number;
  label: string;
  delta: string | number;
  band: number;
  breakdown: {
    education: number;
    skills: number;
    experience: number;
    projects: number;
    presentation: number;
  };
}

export interface ProfileViewItem {
  employer_name: string;
  last_viewed_at: string;
}

export interface ProfileViewsPage {
  items: ProfileViewItem[];
  next_cursor: string | null;
  total: number | null;
}
