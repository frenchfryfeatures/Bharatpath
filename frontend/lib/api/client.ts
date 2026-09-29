import { API_CONFIG } from "@/config/api";
import { getStoredToken } from "@/lib/auth/token";
import { ApiError } from "./errors";

interface RequestOptions extends RequestInit {
  timeout?: number;
}

class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      options.timeout ?? API_CONFIG.timeout,
    );

    try {
      const hasAuthHeader =
        options.headers &&
        "Authorization" in
          (options.headers as Record<string, string>);

      const bearerToken =
        !hasAuthHeader
          ? getStoredToken() ?? process.env.NEXT_PUBLIC_API_BEARER_TOKEN
          : null;

      const response = await fetch(
        `${this.baseUrl}${endpoint}`,
        {
          ...options,
          signal: controller.signal,
          credentials: "include",
          headers: {
            Accept: "application/json",
            ...(!(options.body instanceof FormData) && {
              "Content-Type": "application/json",
            }),
            ...(bearerToken && {
              Authorization: `Bearer ${bearerToken}`,
            }),
            ...options.headers,
          },
        },
      );

      const contentType =
        response.headers.get("content-type") ?? "";

      const result = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        throw new ApiError(
          typeof result === "object"
            ? result?.message ?? "API request failed"
            : "API request failed",
          response.status,
          typeof result === "object"
            ? result?.code
            : undefined,
        );
      }

      return result as T;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError(
          "Request timed out",
          408,
          "REQUEST_TIMEOUT",
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  get<T>(
    endpoint: string,
    options?: RequestOptions,
  ) {
    return this.request<T>(endpoint, {
      ...options,
      method: "GET",
    });
  }

  post<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions,
  ) {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body:
        body instanceof FormData
          ? body
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    });
  }

  put<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions,
  ) {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body:
        body instanceof FormData
          ? body
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    });
  }

  patch<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions,
  ) {
    return this.request<T>(endpoint, {
      ...options,
      method: "PATCH",
      body:
        body instanceof FormData
          ? body
          : body !== undefined
            ? JSON.stringify(body)
            : undefined,
    });
  }

  delete<T>(
    endpoint: string,
    options?: RequestOptions,
  ) {
    return this.request<T>(endpoint, {
      ...options,
      method: "DELETE",
    });
  }
}

export const apiClient = new ApiClient(
  API_CONFIG.baseUrl,
);
