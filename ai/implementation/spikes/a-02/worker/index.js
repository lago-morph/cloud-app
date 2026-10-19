export default {
  fetch(request) {
    return new Response("spike a-02 ok " + new URL(request.url).pathname, {
      headers: { "content-type": "text/plain" },
    });
  },
};
