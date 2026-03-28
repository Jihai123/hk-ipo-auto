Component({
  properties: {
    mode: {
      type: String,
      value: 'loading',
    },
    title: {
      type: String,
      value: '',
    },
    subtitle: {
      type: String,
      value: '',
    },
    actionText: {
      type: String,
      value: '',
    },
  },
  methods: {
    onActionTap() {
      this.triggerEvent('action');
    },
  },
});
