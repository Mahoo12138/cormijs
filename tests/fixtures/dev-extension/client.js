export default {
  setup({ options }) {
    document.documentElement.dataset.cormiApiFixture = options.label;
    return () => { delete document.documentElement.dataset.cormiApiFixture; };
  },
};
