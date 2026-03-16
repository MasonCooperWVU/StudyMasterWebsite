module.exports = async function (context, req) {
  context.res = {
    headers: { "Content-Type": "application/json" },
    body: {
      VITE_BLOB_ACCOUNT:   process.env.VITE_BLOB_ACCOUNT   || '',
      VITE_BLOB_CONTAINER: process.env.VITE_BLOB_CONTAINER || '',
      VITE_BLOB_SAS:       process.env.VITE_BLOB_SAS       || '',
    }
  };
};