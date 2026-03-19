class BanList {
  constructor() {
    this.bannedUsers = new Set();
    this.bannedKeywords = new Set();
    this.bannedUrls = new Set();
  }

  addUser(username) {
    if (username) {
      this.bannedUsers.add(username.toLowerCase());
    }
  }

  removeUser(username) {
    if (username) {
      this.bannedUsers.delete(username.toLowerCase());
    }
  }

  isUserBanned(username) {
    if (!username) return false;
    return this.bannedUsers.has(username.toLowerCase());
  }

  addKeyword(keyword) {
    if (keyword) {
      this.bannedKeywords.add(keyword.toLowerCase());
    }
  }

  removeKeyword(keyword) {
    if (keyword) {
      this.bannedKeywords.delete(keyword.toLowerCase());
    }
  }

  matchesKeyword(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    for (const keyword of this.bannedKeywords) {
      if (lower.includes(keyword)) return true;
    }
    return false;
  }

  addUrl(url) {
    if (url) {
      this.bannedUrls.add(url);
    }
  }

  removeUrl(url) {
    if (url) {
      this.bannedUrls.delete(url);
    }
  }

  isUrlBanned(url) {
    if (!url) return false;
    return this.bannedUrls.has(url);
  }
}

module.exports = BanList;
