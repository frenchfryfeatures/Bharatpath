import { baseApi } from "./base-api";

/*
 * Profile photos and organisation logos - `/profile/photo`,
 * `/employer/organisation/logo`, `/college/organisation/logo`.
 *
 * All three share one shape: GET the current image, POST /upload for a
 * presigned PUT ticket, PUT the bytes straight to S3, POST /confirm, and
 * DELETE to remove. The server re-encodes the file, so what `GET` returns
 * is not what was uploaded.
 */

export type ProfileImageTarget = "photo" | "employer-logo" | "college-logo";

const BASE_PATH: Record<ProfileImageTarget, string> = {
  photo: "/profile/photo",
  "employer-logo": "/employer/organisation/logo",
  "college-logo": "/college/organisation/logo",
};

/** Every field is null when there is no image. */
export interface ProfileImage {
  url: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  updatedAt: string | null;
  expiresInSeconds: number | null;
}

export interface ImageUploadTicket {
  uploadId: string;
  url: string;
  expiresInSeconds: number;
  maxBytes: number;
  acceptedTypes: string[];
}

interface ImageResponse {
  url: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  updated_at: string | null;
  expires_in_seconds: number | null;
}

function mapImage(response: ImageResponse): ProfileImage {
  return {
    url: response.url,
    mime: response.mime,
    width: response.width,
    height: response.height,
    updatedAt: response.updated_at,
    expiresInSeconds: response.expires_in_seconds,
  };
}

export const profileImageApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getProfileImage: builder.query<ProfileImage, ProfileImageTarget>({
      query: (target) => BASE_PATH[target],
      transformResponse: mapImage,
      providesTags: (_result, _error, target) => [{ type: "Image", id: target }],
    }),

    createProfileImageUpload: builder.mutation<ImageUploadTicket, ProfileImageTarget>({
      query: (target) => ({ url: `${BASE_PATH[target]}/upload`, method: "POST" }),
      transformResponse: (response: {
        upload_id: string;
        url: string;
        expires_in_seconds: number;
        max_bytes: number;
        accepted_types: string[];
      }) => ({
        uploadId: response.upload_id,
        url: response.url,
        expiresInSeconds: response.expires_in_seconds,
        maxBytes: response.max_bytes,
        acceptedTypes: response.accepted_types,
      }),
    }),

    /*
     * PUTs the raw bytes to the presigned S3 URL. A plain fetch, not the API
     * base query: S3 must never see our Authorization header.
     */
    uploadProfileImageFile: builder.mutation<
      null,
      { ticket: ImageUploadTicket; file: File }
    >({
      queryFn: async ({ ticket, file }) => {
        try {
          const response = await fetch(ticket.url, {
            method: "PUT",
            body: file,
            headers: file.type ? { "Content-Type": file.type } : undefined,
          });

          if (!response.ok) {
            return {
              error: { status: response.status, data: await response.text() },
            };
          }

          return { data: null };
        } catch (error) {
          return {
            error: { status: "FETCH_ERROR" as const, error: String(error) },
          };
        }
      },
    }),

    confirmProfileImage: builder.mutation<
      ProfileImage,
      { target: ProfileImageTarget; uploadId: string }
    >({
      query: ({ target, uploadId }) => ({
        url: `${BASE_PATH[target]}/confirm`,
        method: "POST",
        body: { upload_id: uploadId },
      }),
      transformResponse: mapImage,
      invalidatesTags: (_result, _error, { target }) => [{ type: "Image", id: target }],
    }),

    deleteProfileImage: builder.mutation<ProfileImage, ProfileImageTarget>({
      query: (target) => ({ url: BASE_PATH[target], method: "DELETE" }),
      transformResponse: mapImage,
      invalidatesTags: (_result, _error, target) => [{ type: "Image", id: target }],
    }),
  }),
});

export const {
  useGetProfileImageQuery,
  useCreateProfileImageUploadMutation,
  useUploadProfileImageFileMutation,
  useConfirmProfileImageMutation,
  useDeleteProfileImageMutation,
} = profileImageApi;
