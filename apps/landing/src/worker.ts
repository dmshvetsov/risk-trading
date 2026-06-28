export default {
  async fetch(
    request: Request,
    env: {
      ASSETS: {
        fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
      };
    },
  ): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
