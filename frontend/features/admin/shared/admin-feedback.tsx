"use client";

import { useEffect } from "react";

import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { clearAdminFeedback } from "@/store/admin";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectAdminFeedback } from "@/store/admin/feedback/selectors";

export function AdminFeedback() {
  const dispatch = useAppDispatch();
  const message = useAppSelector(selectAdminFeedback);

  useEffect(() => {
    if (!message) {
      return;
    }

    showSuccessFeedback(message);
    dispatch(clearAdminFeedback());
  }, [dispatch, message]);

  return null;
}