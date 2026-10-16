package dev.carthingfw.nav

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress

class ClientFilterTest {
    private fun ip(s: String) = InetAddress.getByName(s)
    private fun bytes(s: String) = ip(s).address

    private val nets = listOf(
        ClientFilter.Net("bt-pan", bytes("192.168.44.1"), 24),
        ClientFilter.Net("wlan0", bytes("192.168.1.23"), 24),
    )

    @Test
    fun theTetherIsAlwaysAllowed() {
        assertTrue(ClientFilter.allowed(ip("192.168.44.57"), allowLan = false, nets = nets))
    }

    @Test
    fun wifiNeedsTheTestingSwitch() {
        assertFalse(ClientFilter.allowed(ip("192.168.1.50"), allowLan = false, nets = nets))
        assertTrue(ClientFilter.allowed(ip("192.168.1.50"), allowLan = true, nets = nets))
    }

    @Test
    fun aTetherWithAnotherNameStillCounts() {
        val vendor = listOf(ClientFilter.Net("bnep0", bytes("192.168.44.1"), 24))
        assertTrue(ClientFilter.allowed(ip("192.168.44.57"), allowLan = false, nets = vendor))
        val other = listOf(ClientFilter.Net("btpan0", bytes("10.105.12.1"), 24))
        assertTrue(ClientFilter.allowed(ip("10.105.12.9"), allowLan = false, nets = other))
    }

    @Test
    fun hotspotMobileDataAndVpnAreNotTheTether() {
        for (name in listOf("swlan0", "ap0", "wlan1", "rmnet_data0", "tun0", "v4-rmnet_data0")) {
            val n = listOf(ClientFilter.Net(name, bytes("192.168.50.1"), 24))
            assertFalse(name, ClientFilter.allowed(ip("192.168.50.9"), allowLan = false, nets = n))
        }
    }

    @Test
    fun publicAddressesNeverGetIn() {
        assertFalse(ClientFilter.allowed(ip("8.8.8.8"), allowLan = true, nets = nets))
    }

    @Test
    fun prefixMasking() {
        val net = ClientFilter.Net("bt-pan", bytes("10.0.0.1"), 20)
        assertTrue(ClientFilter.inNet(bytes("10.0.15.200"), net))
        assertFalse(ClientFilter.inNet(bytes("10.0.16.1"), net))
    }
}
