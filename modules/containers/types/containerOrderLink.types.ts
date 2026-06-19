export const ORDER_ALREADY_HAS_CONTAINER = "order_already_has_container" as const;

export type ContainerOrderLinkErrorCode = typeof ORDER_ALREADY_HAS_CONTAINER;

export type ContainerOrderLinkValidationResult =
  | { ok: true; ordenIdsToLink: string[] }
  | {
      ok: false;
      code: ContainerOrderLinkErrorCode;
      error: string;
      status: number;
    };
