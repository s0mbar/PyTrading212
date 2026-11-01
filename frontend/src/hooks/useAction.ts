import { useCallback, useState } from "react";

import { errorMessage, UnauthorizedError } from "../api/http";

export type ActionState = {
  pending: boolean;
  error: string;
  success: string;
};

/**
 * Runs a user-triggered async action with a pending flag, a French error
 * message and an optional success message. An expired token is handled by
 * the global 401 handler, so it is not shown as an error here.
 */
export function useAction() {
  const [state, setState] = useState<ActionState>({ pending: false, error: "", success: "" });

  const run = useCallback(async <T,>(action: () => Promise<T>, successMessage = ""): Promise<T | undefined> => {
    setState({ pending: true, error: "", success: "" });
    try {
      const result = await action();
      setState({ pending: false, error: "", success: successMessage });
      return result;
    } catch (err) {
      setState({
        pending: false,
        error: err instanceof UnauthorizedError ? "" : errorMessage(err, "Une erreur est survenue."),
        success: "",
      });
      return undefined;
    }
  }, []);

  const reset = useCallback(() => setState({ pending: false, error: "", success: "" }), []);
  const succeed = useCallback((message: string) => setState({ pending: false, error: "", success: message }), []);

  return { ...state, run, reset, succeed };
}
