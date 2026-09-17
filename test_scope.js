function openRestoreProfileModal() {
  function close() {
    console.log("Local close");
  }
  
  const obj = {
    func: async function() {
      close();
    }
  };
  obj.func();
}
openRestoreProfileModal();
