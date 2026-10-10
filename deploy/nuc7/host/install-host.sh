#!/usr/bin/env bash
# nuc7 root 설정을 한 번 한다. 저장소를 받은 뒤 사용자가 직접 실행한다:
#   sudo /opt/paceon/src/deploy/nuc7/host/install-host.sh
# 타이머는 설치만 하고 켜지 않는다(PLAN.md Task 12·13에서 켠다). ufw와 다른 서비스는 건드리지 않는다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
user="${SUDO_USER:?sudo로 실행하세요}"

apt-get update
apt-get install -y docker.io docker-compose-v2 age rclone

install -m 0644 "$here/paceon.slice" /etc/systemd/system/paceon.slice
install -d /etc/docker
if [ -e /etc/docker/daemon.json ] && ! cmp -s "$here/daemon.json" /etc/docker/daemon.json; then
  echo "/etc/docker/daemon.json이 이미 다릅니다. 직접 합친 뒤 다시 실행하세요." >&2
  exit 1
fi
install -m 0644 "$here/daemon.json" /etc/docker/daemon.json
for unit in paceon-deploy.service paceon-deploy.timer paceon-backup.service paceon-backup.timer; do
  install -m 0644 "$here/$unit" "/etc/systemd/system/$unit"
done
usermod -aG docker "$user"
install -d -o "$user" -g "$user" -m 0750 /opt/paceon/data
systemctl daemon-reload
systemctl enable --now docker
systemctl restart docker
echo "끝났습니다. $user는 다시 로그인해야 docker 그룹이 적용됩니다."
