import yaml from 'js-yaml'
import nconf from '../nconf'
import { request } from '../../common/util'
import { logger } from '../../common/debug'

const log = logger('github')

const HOOK_PATH = '/repos/${owner}/${repo}/hooks'
const PR_PATH = '/repos/${owner}/${repo}/pulls/${number}'
const STATUS_PATH = '/repos/${owner}/${repo}/statuses/${sha}'
const COMMENT_PATH = '/repos/${owner}/${repo}/issues/${number}/comments'
const ZAPPR_FILE_REPO_PATH = '/repos/${owner}/${repo}/contents' + nconf.get('ZAPPR_FILE_PATH')

export default class GithubService {

  getOptions(method, path, body, accessToken) {
    let url = nconf.get('GITHUB_URL') + path

    return {
      json: true,
      method: method,
      url,
      headers: {
        'User-Agent': 'ZAPPR/1.0 (+https://zappr.hackweek.zalan.do)',
        'Authorization': `token ${accessToken}`
      },
      body: body
    }
  }

  formatDate(date) {
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    const day = date.getUTCDate()
    const hour = date.getUTCHours()
    const minute = date.getUTCMinutes()
    const second = date.getUTCSeconds()
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
  }

  async fetchPath(method, path, payload, accessToken) {
    const options = this.getOptions(method, path, payload, accessToken)
    const [response, body] = await request(options)
    const {statusCode} = response || {}

    if ([200, 201, 202, 203, 204].indexOf(statusCode) < 0) {
      log(statusCode, method, path, response.body, options)
      throw new Error(statusCode)
    }
    else return body
  }

  setCommitStatus(user, repo, sha, status, accessToken) {
    let path = STATUS_PATH
                .replace('${owner}', user)
                .replace('${repo}', repo)
                .replace('${sha}', sha)
    return this.fetchPath('POST', path, status, accessToken)
  }

  async getApprovals(user, repo, pr, pattern, accessToken) {
    const comments = await this.getComments(user, repo, pr.number, pr.updated_at, accessToken)
    return comments.filter(c => (new RegExp(pattern)).test(c.body) !== -1).length
  }

  getComments(user, repo, number, since, accessToken) {
    let path = COMMENT_PATH
                  .replace('${owner}', user)
                  .replace('${repo}', repo)
                  .replace('${number}', number)
    if (since) {
      path += `?since=${since}`
    }
    return this.fetchPath('GET', path, null, accessToken)
  }

  async getPullRequest(user, repo, number, accessToken) {
    const path = PR_PATH
                  .replace('${owner}', user)
                  .replace('${repo}', repo)
                  .replace('${number}', number)
    try {
      const pr = await this.fetchPath('GET', path, null, accessToken)
      log(`${user}/${repo}:${number} is a pull request`)
      return pr
    } catch(e) {
      log(`${user}/${repo}:${number} is NOT a pull request`)
      return false
    }
  }

  async readZapprFile(user, repo, accessToken) {
    // fetch file info
    const path = ZAPPR_FILE_REPO_PATH.replace('${owner}', user).replace('${repo}', repo)
    let {content} = await this.fetchPath('GET', path, null, accessToken)
    // short circuit if there is no such file
    if (!content) {
      return {}
    }
    // decode file content
    let file = Buffer(content, 'base64').toString('utf8')
    return yaml.safeLoad(file)
  }

  async updateWebhookFor(user, repo, events, accessToken) {
    log(`updating webhook for ${user}/${repo}`)
    let path = HOOK_PATH.replace('${owner}', user).replace('${repo}', repo)
    let hook_url = nconf.get('HOST_ADDR') + '/api/hook'
    // payload for hook
    let payload = {
      name: 'web',
      active: true,
      events,
      config: {
        url: hook_url,
        content_type: 'json'
      }
    }
    // check if it's there already
    let hooks = await this.fetchPath('GET', path, null, accessToken)
    let existing = hooks.find(h => h.config.url === hook_url)
    if (!!existing) {
      path += `/${existing.id}`
      if (payload.events.length) {
        log(`updating existing hook ${existing.id}`)
        return this.fetchPath('PATCH', path, payload, accessToken)
      } else {
        log(`deleting webhook ${existing.id}`)
        return this.fetchPath('DELETE', path)
      }
    } else {
      log('creating new hook')
      return this.fetchPath('POST', path, payload, accessToken)
    }
  }

  fetchRepos(accessToken) {
    return this.fetchPath('GET', '/user/repos', null, accessToken)
  }
}
